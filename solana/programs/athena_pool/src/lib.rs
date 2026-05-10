// SPDX-License-Identifier: MIT
//
// AthenaPool — Solana port of contracts/AthenaPool.sol
//
// Multi-case donation pool. Each case is a PDA derived from
// [b"case", case_id] where case_id is a fixed-size [u8; 16]
// (UUID v4 without dashes). Funds donated to a case live as
// lamports inside the PDA itself; the PDA's data account stores
// the metadata (owner, safe_contact, totals, status).
//
// Behavior parity with the Solidity contract:
//   - createCase(caseId, owner, safeContact)        -> initialize_case
//   - donate(caseId) payable                        -> donate(caseId, amount)
//   - withdraw(caseId, amount)                      -> withdraw
//   - triggerSOS(caseId)                            -> trigger_sos
//   - setSafeContact(caseId, newContact)            -> set_safe_contact
//
// Differences worth noting:
//   * Solana has no `mapping(string => Case)`. Cases are individual
//     PDAs; listing them all requires an off-chain indexer.
//   * `payable(c.safeContact).transfer(amount)` is replaced with a
//     manual lamports adjustment (PDAs can't use system_program::transfer
//     as the source because they hold data).
//   * `donor_count` here is actually a donation counter for MVP. Tracking
//     unique donors would require a per-donor PDA.
//   * `caseId` is now a fixed [u8; 16] for predictable rent.

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("GHhuwP2XesUboREQGZ7dDEKArnEv1hUiSPyvvWhsECgh");

pub const CASE_SEED: &[u8] = b"case";
pub const GLOBAL_SEED: &[u8] = b"global";

#[program]
pub mod athena_pool {
    use super::*;

    /// Initialize the global state once per deployment. Stores the
    /// admin pubkey and a counter of created cases. Idempotent —
    /// fails if called twice.
    pub fn initialize_global(ctx: Context<InitializeGlobal>) -> Result<()> {
        let global = &mut ctx.accounts.global;
        global.admin = ctx.accounts.admin.key();
        global.case_count = 0;
        global.bump = ctx.bumps.global;
        Ok(())
    }

    /// Equivalent of Solidity `createCase`. Only the admin (signer of
    /// `initialize_global`) can call this.
    pub fn initialize_case(
        ctx: Context<InitializeCase>,
        case_id: [u8; 16],
        owner: Pubkey,
        safe_contact: Pubkey,
    ) -> Result<()> {
        require!(owner != Pubkey::default(), AthenaError::InvalidAddress);

        let now = Clock::get()?.unix_timestamp;
        let case = &mut ctx.accounts.case;
        case.case_id = case_id;
        case.owner = owner;
        case.safe_contact = safe_contact;
        case.total_donations = 0;
        case.donation_count = 0;
        case.is_active = true;
        case.created_at = now;
        case.bump = ctx.bumps.case;

        let global = &mut ctx.accounts.global;
        global.case_count = global.case_count.saturating_add(1);

        emit!(CaseCreated {
            case_id,
            owner,
            safe_contact,
            timestamp: now,
        });
        Ok(())
    }

    /// Equivalent of `donate(caseId) payable`. Anyone can donate; the
    /// SOL is transferred from the donor's wallet to the case PDA via
    /// a system_program CPI.
    pub fn donate(ctx: Context<Donate>, _case_id: [u8; 16], amount: u64) -> Result<()> {
        require!(amount > 0, AthenaError::ZeroAmount);
        require!(ctx.accounts.case.is_active, AthenaError::CaseInactive);

        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.donor.to_account_info(),
                    to: ctx.accounts.case.to_account_info(),
                },
            ),
            amount,
        )?;

        let now = Clock::get()?.unix_timestamp;
        let case = &mut ctx.accounts.case;
        case.total_donations = case.total_donations.saturating_add(amount);
        case.donation_count = case.donation_count.saturating_add(1);

        emit!(DonationReceived {
            case_id: case.case_id,
            donor: ctx.accounts.donor.key(),
            amount,
            timestamp: now,
        });
        Ok(())
    }

    /// Equivalent of `withdraw(caseId, amount)`. Only the case owner.
    /// Cannot drain below the rent-exempt minimum, so the PDA itself
    /// stays alive.
    pub fn withdraw(ctx: Context<Withdraw>, _case_id: [u8; 16], amount: u64) -> Result<()> {
        require!(amount > 0, AthenaError::ZeroAmount);

        let case_info = ctx.accounts.case.to_account_info();
        let rent_min = Rent::get()?.minimum_balance(case_info.data_len());
        let available = case_info.lamports().saturating_sub(rent_min);
        require!(amount <= available, AthenaError::InsufficientBalance);

        // Direct lamport adjustment — required because the source is a
        // data account and CPI to system_program::transfer would fail.
        **case_info.try_borrow_mut_lamports()? = case_info
            .lamports()
            .checked_sub(amount)
            .ok_or(AthenaError::Overflow)?;
        **ctx.accounts.owner.to_account_info().try_borrow_mut_lamports()? = ctx
            .accounts
            .owner
            .to_account_info()
            .lamports()
            .checked_add(amount)
            .ok_or(AthenaError::Overflow)?;

        emit!(FundsWithdrawn {
            case_id: ctx.accounts.case.case_id,
            to: ctx.accounts.owner.key(),
            amount,
        });
        Ok(())
    }

    /// Equivalent of `triggerSOS`. Atomically:
    ///   1. Drains all donations (lamports above rent minimum)
    ///   2. Transfers them to the registered safe_contact
    ///   3. Marks the case inactive
    /// All in a single Solana transaction.
    pub fn trigger_sos(ctx: Context<TriggerSos>, _case_id: [u8; 16]) -> Result<()> {
        let case_info = ctx.accounts.case.to_account_info();
        let rent_min = Rent::get()?.minimum_balance(case_info.data_len());
        let amount = case_info.lamports().saturating_sub(rent_min);
        require!(amount > 0, AthenaError::ZeroBalance);

        // Mutable scope to flip is_active and access stored case_id.
        let case_id;
        {
            let case = &mut ctx.accounts.case;
            require!(case.is_active, AthenaError::CaseInactive);
            require!(
                case.safe_contact != Pubkey::default(),
                AthenaError::NoSafeContact
            );
            case.is_active = false;
            case_id = case.case_id;
        }

        **case_info.try_borrow_mut_lamports()? = case_info
            .lamports()
            .checked_sub(amount)
            .ok_or(AthenaError::Overflow)?;
        **ctx.accounts.safe_contact.try_borrow_mut_lamports()? = ctx
            .accounts
            .safe_contact
            .lamports()
            .checked_add(amount)
            .ok_or(AthenaError::Overflow)?;

        emit!(SosTriggered {
            case_id,
            safe_contact: ctx.accounts.safe_contact.key(),
            amount,
        });
        emit!(CaseDeactivated { case_id });
        Ok(())
    }

    /// Equivalent of `setSafeContact`. Only the case owner.
    pub fn set_safe_contact(
        ctx: Context<SetSafeContact>,
        _case_id: [u8; 16],
        new_contact: Pubkey,
    ) -> Result<()> {
        require!(new_contact != Pubkey::default(), AthenaError::InvalidAddress);
        let case = &mut ctx.accounts.case;
        case.safe_contact = new_contact;
        emit!(SafeContactUpdated {
            case_id: case.case_id,
            new_contact,
        });
        Ok(())
    }

    /// Admin recovery: replace the owner of a case. Equivalent of
    /// `updateCaseOwner` in the Solidity version.
    pub fn admin_update_owner(
        ctx: Context<AdminUpdateOwner>,
        _case_id: [u8; 16],
        new_owner: Pubkey,
    ) -> Result<()> {
        require!(new_owner != Pubkey::default(), AthenaError::InvalidAddress);
        ctx.accounts.case.owner = new_owner;
        Ok(())
    }
}

// ====== Account state ======

#[account]
#[derive(InitSpace)]
pub struct Global {
    pub admin: Pubkey,
    pub case_count: u64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct Case {
    pub case_id: [u8; 16],
    pub owner: Pubkey,
    pub safe_contact: Pubkey,
    pub total_donations: u64,
    pub donation_count: u32,
    pub is_active: bool,
    pub created_at: i64,
    pub bump: u8,
}

// ====== Instruction account contexts ======

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(
        init,
        payer = admin,
        seeds = [GLOBAL_SEED],
        bump,
        space = 8 + Global::INIT_SPACE,
    )]
    pub global: Account<'info, Global>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(case_id: [u8; 16])]
pub struct InitializeCase<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_SEED],
        bump = global.bump,
        has_one = admin @ AthenaError::NotAdmin,
    )]
    pub global: Account<'info, Global>,

    #[account(
        init,
        payer = admin,
        seeds = [CASE_SEED, case_id.as_ref()],
        bump,
        space = 8 + Case::INIT_SPACE,
    )]
    pub case: Account<'info, Case>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(case_id: [u8; 16])]
pub struct Donate<'info> {
    #[account(
        mut,
        seeds = [CASE_SEED, case_id.as_ref()],
        bump = case.bump,
    )]
    pub case: Account<'info, Case>,

    #[account(mut)]
    pub donor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(case_id: [u8; 16])]
pub struct Withdraw<'info> {
    #[account(
        mut,
        seeds = [CASE_SEED, case_id.as_ref()],
        bump = case.bump,
        has_one = owner @ AthenaError::NotOwner,
    )]
    pub case: Account<'info, Case>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(case_id: [u8; 16])]
pub struct TriggerSos<'info> {
    #[account(
        mut,
        seeds = [CASE_SEED, case_id.as_ref()],
        bump = case.bump,
        has_one = owner @ AthenaError::NotOwner,
        has_one = safe_contact @ AthenaError::SafeContactMismatch,
    )]
    pub case: Account<'info, Case>,

    pub owner: Signer<'info>,

    /// CHECK: receiver of all funds. Validated by `has_one = safe_contact`
    /// on the case account, which guarantees this address matches the
    /// pubkey stored when the case was created.
    #[account(mut)]
    pub safe_contact: AccountInfo<'info>,
}

#[derive(Accounts)]
#[instruction(case_id: [u8; 16])]
pub struct SetSafeContact<'info> {
    #[account(
        mut,
        seeds = [CASE_SEED, case_id.as_ref()],
        bump = case.bump,
        has_one = owner @ AthenaError::NotOwner,
    )]
    pub case: Account<'info, Case>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(case_id: [u8; 16])]
pub struct AdminUpdateOwner<'info> {
    #[account(
        seeds = [GLOBAL_SEED],
        bump = global.bump,
        has_one = admin @ AthenaError::NotAdmin,
    )]
    pub global: Account<'info, Global>,

    #[account(
        mut,
        seeds = [CASE_SEED, case_id.as_ref()],
        bump = case.bump,
    )]
    pub case: Account<'info, Case>,

    pub admin: Signer<'info>,
}

// ====== Events ======

#[event]
pub struct CaseCreated {
    pub case_id: [u8; 16],
    pub owner: Pubkey,
    pub safe_contact: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DonationReceived {
    pub case_id: [u8; 16],
    pub donor: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct FundsWithdrawn {
    pub case_id: [u8; 16],
    pub to: Pubkey,
    pub amount: u64,
}

#[event]
pub struct SosTriggered {
    pub case_id: [u8; 16],
    pub safe_contact: Pubkey,
    pub amount: u64,
}

#[event]
pub struct CaseDeactivated {
    pub case_id: [u8; 16],
}

#[event]
pub struct SafeContactUpdated {
    pub case_id: [u8; 16],
    pub new_contact: Pubkey,
}

// ====== Errors ======

#[error_code]
pub enum AthenaError {
    #[msg("Donation must be greater than zero")]
    ZeroAmount,
    #[msg("Case is not active")]
    CaseInactive,
    #[msg("Case has zero withdrawable balance")]
    ZeroBalance,
    #[msg("Insufficient balance for withdrawal")]
    InsufficientBalance,
    #[msg("Caller is not the case owner")]
    NotOwner,
    #[msg("Caller is not the platform admin")]
    NotAdmin,
    #[msg("Provided safe_contact does not match the registered one")]
    SafeContactMismatch,
    #[msg("Safe contact is not configured")]
    NoSafeContact,
    #[msg("Invalid address (zero pubkey)")]
    InvalidAddress,
    #[msg("Numeric overflow")]
    Overflow,
}
