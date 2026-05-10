/**
 * Chain Router
 * ------------
 * MVP / hackathon build: **hard-locked to Solana Devnet** so nothing in the
 * OS shell (`VITE_CHAIN`, `process.env`, etc.) can silently flip you back to
 * Fraxtal. To restore the dual-chain router, replace the constant below with
 * env-based logic again.
 *
 * Every vault/pool/evidence service exposes the SAME shape so the
 * agent code in `athena-agent.ts` doesn't branch on chain identity.
 */

import { type VaultState, type SOSResult, type TransactionResult } from './frax-service';
import { getSolanaVaultService } from './solana-vault-service';
import { getSolanaPoolClient } from './solana-pool-client';

// ============ Public chain identity ============

export type ChainKind = 'fraxtal' | 'solana';

/** Hard lock: always Solana for this repo / demo. Ignores `VITE_CHAIN`. */
export const ACTIVE_CHAIN: ChainKind = 'solana';

if (typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.info('%c[chain-router] ACTIVE_CHAIN=solana (hardcoded)', 'color:#a78bfa;font-weight:bold;');
}

export const isSolana = (): boolean => true;
export const isFraxtal = (): boolean => false;

// ============ Chain-agnostic vault interface ============

/**
 * Surface the agent needs from any vault backend. Both `FraxService`
 * and `SolanaVaultService` already implement this shape — the interface
 * is here for documentation and future TypeScript narrowing.
 */
export interface VaultBackend {
    getAddress(): string;
    isOnline(): boolean;
    getVaultState(): Promise<VaultState>;
    getAPY(): Promise<number>;
    depositToVault(amount: number): Promise<TransactionResult>;
    redeemFromVault(amountShares: number): Promise<TransactionResult>;
    transferFrax(toAddress: string, amount: number): Promise<TransactionResult>;
    triggerSOS(destinationAddress: string): Promise<SOSResult>;
    storeEvidenceHash(hash: string, metadata?: string): Promise<TransactionResult>;
    getNetworkInfo(): {
        name: string;
        rpcUrl: string;
        chainId: number;
        explorerUrl: string;
        sFraxAddress: string;
        fraxAddress: string;
        usdcAddress: string;
    };
}

// ============ Active service getters ============

/** Hard-locked: always Solana vault. */
export const getActiveVaultService = (): VaultBackend =>
    getSolanaVaultService() as unknown as VaultBackend;

/** Hard-locked: always Solana pool client. */
export const getActivePoolService = () => getSolanaPoolClient();

/** Evidence service is bundled into the vault backend on both chains. */
export const getActiveEvidenceService = (): Pick<VaultBackend, 'storeEvidenceHash'> => {
    return getActiveVaultService();
};

// ============ Display helpers ============

export interface ExplorerUrls {
    name: string;
    txUrl: (txHash: string) => string;
    addressUrl: (address: string) => string;
}

export const getExplorer = (): ExplorerUrls => {
    const cluster = '?cluster=devnet';
    return {
        name: 'Solscan',
        txUrl: (h) => `https://solscan.io/tx/${h}${cluster}`,
        addressUrl: (a) => `https://solscan.io/account/${a}${cluster}`,
    };
};

/** Format an address for display (truncate; both 0x and base58 supported). */
export const truncateAddress = (
    address: string,
    head: number = 6,
    tail: number = 4,
): string => {
    if (!address) return '';
    if (address.length <= head + tail + 2) return address;
    return `${address.slice(0, head)}...${address.slice(-tail)}`;
};
