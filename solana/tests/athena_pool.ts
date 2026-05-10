import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";
import { expect } from "chai";
import { AthenaPool } from "../target/types/athena_pool";

// Helpers ------------------------------------------------------------

function caseIdFromString(label: string): Buffer {
    const buf = Buffer.alloc(16, 0);
    Buffer.from(label, "utf8").copy(buf, 0, 0, Math.min(label.length, 16));
    return buf;
}

function casePda(programId: PublicKey, caseId: Buffer): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("case"), caseId],
        programId
    );
}

function globalPda(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync([Buffer.from("global")], programId);
}

async function airdrop(
    provider: anchor.AnchorProvider,
    to: PublicKey,
    sol: number
) {
    const sig = await provider.connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
}

// Tests --------------------------------------------------------------

describe("athena_pool", () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.AthenaPool as Program<AthenaPool>;

    const admin = (provider.wallet as anchor.Wallet).payer;
    const caseOwner = Keypair.generate();
    const safeContact = Keypair.generate();
    const donor = Keypair.generate();

    const caseId = caseIdFromString("ATHENA-CASE-001");

    before(async () => {
        await airdrop(provider, caseOwner.publicKey, 2);
        await airdrop(provider, safeContact.publicKey, 0.01);
        await airdrop(provider, donor.publicKey, 5);
    });

    it("initializes the global state once", async () => {
        const [global] = globalPda(program.programId);

        try {
            await program.account.global.fetch(global);
            console.log("[test] global already initialized, skipping");
        } catch {
            await program.methods
                .initializeGlobal()
                .accounts({
                    global,
                    admin: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
        }

        const g = await program.account.global.fetch(global);
        expect(g.admin.toBase58()).to.equal(admin.publicKey.toBase58());
    });

    it("creates a case (admin only)", async () => {
        const [global] = globalPda(program.programId);
        const [casePk] = casePda(program.programId, caseId);

        await program.methods
            .initializeCase(
                Array.from(caseId) as any,
                caseOwner.publicKey,
                safeContact.publicKey
            )
            .accounts({
                global,
                case: casePk,
                admin: admin.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        const c = await program.account.case.fetch(casePk);
        expect(c.owner.toBase58()).to.equal(caseOwner.publicKey.toBase58());
        expect(c.safeContact.toBase58()).to.equal(safeContact.publicKey.toBase58());
        expect(c.isActive).to.equal(true);
        expect(c.totalDonations.toString()).to.equal("0");
    });

    it("rejects creating the same case twice", async () => {
        const [global] = globalPda(program.programId);
        const [casePk] = casePda(program.programId, caseId);

        let threw = false;
        try {
            await program.methods
                .initializeCase(
                    Array.from(caseId) as any,
                    caseOwner.publicKey,
                    safeContact.publicKey
                )
                .accounts({
                    global,
                    case: casePk,
                    admin: admin.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
        } catch {
            threw = true;
        }
        expect(threw).to.equal(true);
    });

    it("accepts donations and updates totals", async () => {
        const [casePk] = casePda(program.programId, caseId);
        const before = await provider.connection.getBalance(casePk);

        const amount = new BN(0.5 * LAMPORTS_PER_SOL);
        await program.methods
            .donate(Array.from(caseId) as any, amount)
            .accounts({
                case: casePk,
                donor: donor.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .signers([donor])
            .rpc();

        const after = await provider.connection.getBalance(casePk);
        expect(after - before).to.equal(amount.toNumber());

        const c = await program.account.case.fetch(casePk);
        expect(c.totalDonations.toString()).to.equal(amount.toString());
        expect(c.donationCount).to.equal(1);
    });

    it("rejects zero-amount donations", async () => {
        const [casePk] = casePda(program.programId, caseId);
        let threw = false;
        try {
            await program.methods
                .donate(Array.from(caseId) as any, new BN(0))
                .accounts({
                    case: casePk,
                    donor: donor.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([donor])
                .rpc();
        } catch {
            threw = true;
        }
        expect(threw).to.equal(true);
    });

    it("allows the owner to withdraw a partial amount", async () => {
        const [casePk] = casePda(program.programId, caseId);
        const ownerBefore = await provider.connection.getBalance(caseOwner.publicKey);

        const withdrawAmount = new BN(0.1 * LAMPORTS_PER_SOL);
        await program.methods
            .withdraw(Array.from(caseId) as any, withdrawAmount)
            .accounts({
                case: casePk,
                owner: caseOwner.publicKey,
            })
            .signers([caseOwner])
            .rpc();

        const ownerAfter = await provider.connection.getBalance(caseOwner.publicKey);
        expect(ownerAfter - ownerBefore).to.be.closeTo(
            withdrawAmount.toNumber(),
            10_000_000 // tolerance for tx fees
        );
    });

    it("rejects withdraw from non-owner", async () => {
        const [casePk] = casePda(program.programId, caseId);
        let threw = false;
        try {
            await program.methods
                .withdraw(Array.from(caseId) as any, new BN(1))
                .accounts({
                    case: casePk,
                    owner: donor.publicKey, // wrong owner
                })
                .signers([donor])
                .rpc();
        } catch {
            threw = true;
        }
        expect(threw).to.equal(true);
    });

    it("triggers SOS atomically and deactivates the case", async () => {
        const [casePk] = casePda(program.programId, caseId);

        const safeBefore = await provider.connection.getBalance(safeContact.publicKey);
        const caseBefore = await provider.connection.getBalance(casePk);

        await program.methods
            .triggerSos(Array.from(caseId) as any)
            .accounts({
                case: casePk,
                owner: caseOwner.publicKey,
                safeContact: safeContact.publicKey,
            })
            .signers([caseOwner])
            .rpc();

        const safeAfter = await provider.connection.getBalance(safeContact.publicKey);
        const caseAfter = await provider.connection.getBalance(casePk);

        // safe contact should have received roughly (caseBefore - rentMin)
        expect(safeAfter).to.be.greaterThan(safeBefore);
        // case should be drained to ~rent-exempt minimum
        expect(caseAfter).to.be.lessThan(caseBefore);

        const c = await program.account.case.fetch(casePk);
        expect(c.isActive).to.equal(false);
    });

    it("rejects donations after SOS deactivated the case", async () => {
        const [casePk] = casePda(program.programId, caseId);
        let threw = false;
        try {
            await program.methods
                .donate(Array.from(caseId) as any, new BN(1000))
                .accounts({
                    case: casePk,
                    donor: donor.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .signers([donor])
                .rpc();
        } catch {
            threw = true;
        }
        expect(threw).to.equal(true);
    });
});
