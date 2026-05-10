/**
 * Solana Vault Service — Hybrid Mock equivalent of `frax-service.ts`.
 *
 * REAL parts (executed on-chain when wallet/RPC/program are configured):
 *   - SOL balance (`Connection.getBalance`)
 *   - SOL transfer (`SystemProgram.transfer`)
 *   - Evidence write via SPL Memo Program (delegated to solana-evidence-service)
 *   - Atomic SOS via the AthenaPool Anchor program when a `caseId` is bound;
 *     otherwise a direct lamport transfer from agent wallet -> safe contact.
 *
 * SIMULATED parts (kept on purpose so the demo storyline survives):
 *   - "Freedom Vault" yield ("sFRAX") that grows over time.
 *   - APY display.
 *   - "USDC" balance — Solana port keeps a mocked USDC value to stay
 *     compatible with the existing `VaultState` shape consumed by the UI.
 *
 * The point of this file is to mirror the public surface of `FraxService`
 * (the same methods, the same return types) so `athena-agent.ts` is
 * agnostic to the underlying chain.
 */

import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SendTransactionError,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import type {
    VaultState,
    TransactionResult,
    SOSResult,
} from './frax-service';
import { storeEvidenceMemo } from './solana-evidence-service';
import { readSolanaAgentPubkeyEnv, solanaAgentApiUrl } from './solana-agent-api';

// ============ CONFIG ============

const DEFAULT_RPC = 'https://api.devnet.solana.com';
const DEFAULT_EXPLORER = 'https://solscan.io';
const CLUSTER_QS = '?cluster=devnet';
const NETWORK_NAME = 'Solana Devnet';

interface NetworkConfig {
    name: string;
    rpcUrl: string;
    chainId: number;
    sFraxAddress: string;
    fraxAddress: string;
    usdcAddress: string;
    explorerUrl: string;
}

// Same shape NetworkConfig the UI consumes; values are Solana-flavored.
const SOLANA_NETWORK_CONFIG: NetworkConfig = {
    name: NETWORK_NAME,
    rpcUrl: DEFAULT_RPC,
    chainId: 103, // arbitrary marker (Solana doesn't use EVM chainIds)
    sFraxAddress: 'simulated::AthenaFreedomVault',
    fraxAddress: 'native::SOL',
    usdcAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC mainnet mint (display only)
    explorerUrl: DEFAULT_EXPLORER,
};

// ============ HELPERS ============

type VaultEnvKey = 'SOLANA_RPC_URL' | 'SOLANA_KEYPAIR_BASE58';

/**
 * Vite only embeds `import.meta.env.VITE_*` values when the property name is
 * a **static** string (see Vite env handling). Dynamic `meta.env[\`VITE_${key}\`]`
 * stays undefined in the browser bundle, so the keypair never loads.
 */
function readEnv(key: VaultEnvKey): string | undefined {
    try {
        if (key === 'SOLANA_RPC_URL') {
            const v = import.meta.env.VITE_SOLANA_RPC_URL;
            if (v) return String(v).trim();
        }
        if (key === 'SOLANA_KEYPAIR_BASE58') {
            const v = import.meta.env.VITE_SOLANA_KEYPAIR_BASE58;
            if (v) return String(v).trim();
        }
    } catch {
        /* not in Vite */
    }
    if (typeof process !== 'undefined' && process.env) {
        if (key === 'SOLANA_RPC_URL') {
            return (
                process.env.VITE_SOLANA_RPC_URL?.trim() ?? process.env.SOLANA_RPC_URL?.trim()
            );
        }
        if (key === 'SOLANA_KEYPAIR_BASE58') {
            return (
                process.env.VITE_SOLANA_KEYPAIR_BASE58?.trim() ??
                process.env.SOLANA_KEYPAIR_BASE58?.trim()
            );
        }
    }
    return undefined;
}

function loadKeypair(): Keypair | null {
    const secret = readEnv('SOLANA_KEYPAIR_BASE58')?.trim();
    if (!secret) return null;
    try {
        return Keypair.fromSecretKey(bs58.decode(secret));
    } catch (e) {
        console.warn(
            '[SolanaVault] No se pudo decodificar VITE_SOLANA_KEYPAIR_BASE58 (¿JSON array [u8] en vez de base58?).',
            e instanceof Error ? e.message : e,
        );
        return null;
    }
}

function randomTxHash(): string {
    return (
        'demo_' +
        Array(64)
            .fill(0)
            .map(() =>
                'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789'.charAt(
                    Math.floor(Math.random() * 57),
                ),
            )
            .join('')
    );
}

// ============ SERVICE ============

export class SolanaVaultService {
    private connection: Connection;
    private keypair: Keypair | null = null;
    private isConnected = false;
    /** Browser sin VITE_SOLANA_KEYPAIR_BASE58: transferencias / memo / SOS vía API. */
    private readonly remoteWrites: boolean;
    private agentPubkeyCache: string | null = null;

    // Simulated yield state (mirrors the EVM Hybrid Mock pattern)
    private fallbackBaseShares = 0;
    private fallbackStartTime = Date.now();
    private fallbackUsdcBalance = 0;

    constructor() {
        const rpcUrl = readEnv('SOLANA_RPC_URL') ?? DEFAULT_RPC;
        this.connection = new Connection(rpcUrl, 'confirmed');
        this.keypair = loadKeypair();
        this.remoteWrites = typeof window !== 'undefined' && !this.keypair;
        if (!this.keypair && typeof window === 'undefined') {
            console.warn(
                '[SolanaVault] Sin VITE_SOLANA_KEYPAIR_BASE58: la evidencia no se anclará on-chain (SPL Memo) hasta que configures la clave base58 del agente.',
            );
        }
        if (this.remoteWrites) {
            console.info(
                '[SolanaVault] Modo API: firma del agente en servidor (/api/solana/*). Asegúrate de SOLANA_AGENT_KEYPAIR_BASE58 en Vercel.',
            );
        }
        // Ping the cluster lazily to avoid blocking constructor.
        if (this.keypair || this.remoteWrites) {
            this.connection
                .getEpochInfo()
                .then(() => {
                    this.isConnected = true;
                    console.log('[SolanaVault] Connected to', rpcUrl);
                })
                .catch((err) => {
                    console.warn('[SolanaVault] Initial RPC ping failed:', err?.message ?? err);
                });
        }
    }

    // ---------------- Identity ----------------

    public getAddress(): string {
        if (this.keypair) return this.keypair.publicKey.toBase58();
        const env = readSolanaAgentPubkeyEnv();
        if (env) return env;
        return this.agentPubkeyCache ?? '';
    }

    public async prefetchRemoteAgentPubkey(): Promise<void> {
        if (this.keypair) return;
        if (readSolanaAgentPubkeyEnv()) return;
        try {
            const r = await fetch(solanaAgentApiUrl('public-key'));
            const j = (await r.json()) as { ok?: boolean; pubkey?: string };
            if (j.ok && j.pubkey) this.agentPubkeyCache = j.pubkey;
        } catch {
            /* ignore */
        }
    }

    public isOnline(): boolean {
        return this.isConnected && (this.keypair != null || this.remoteWrites);
    }

    public getNetworkInfo(): NetworkConfig {
        return SOLANA_NETWORK_CONFIG;
    }

    // ---------------- Vault state (real SOL + simulated yield) ----------------

    public async getVaultState(): Promise<VaultState> {
        // Simulated yield grows ~5.4% APY linearly to keep parity with the EVM service
        const elapsedSec = (Date.now() - this.fallbackStartTime) / 1000;
        const elapsedYears = elapsedSec / (365 * 24 * 3600);
        const simulatedShares = this.fallbackBaseShares * (1 + 0.054 * elapsedYears);

        let solBalance = 0;
        let online = false;

        const pubStr = this.keypair
            ? this.keypair.publicKey.toBase58()
            : readSolanaAgentPubkeyEnv() || this.agentPubkeyCache || '';

        if (this.keypair) {
            try {
                const lamports = await this.connection.getBalance(this.keypair.publicKey);
                solBalance = lamports / LAMPORTS_PER_SOL;
                online = true;
                this.isConnected = true;
            } catch (err) {
                console.warn('[SolanaVault] getBalance failed, using simulated state:', err);
            }
        } else if (pubStr) {
            try {
                const lamports = await this.connection.getBalance(new PublicKey(pubStr));
                solBalance = lamports / LAMPORTS_PER_SOL;
                online = true;
                this.isConnected = true;
            } catch (err) {
                console.warn('[SolanaVault] getBalance (pubkey) failed, using simulated state:', err);
            }
        }

        // We re-use the EVM `VaultState` field names so the UI doesn't change:
        //   - `sFraxBalance`        -> simulated "Freedom Vault" shares
        //   - `sFraxValueInFrax`    -> same simulated shares value (1:1 simplification)
        //   - `fraxBalance`         -> liquid SOL (the only real on-chain balance here)
        //   - `usdcBalance`         -> simulated USDC
        const state: VaultState = {
            sFraxBalance: simulatedShares,
            sFraxValueInFrax: simulatedShares,
            fraxBalance: solBalance,
            usdcBalance: this.fallbackUsdcBalance,
            totalValueUsd: simulatedShares + solBalance + this.fallbackUsdcBalance,
            apy: 5.4,
            isOnline: online,
            network: online ? NETWORK_NAME : 'Not Connected',
        };
        return state;
    }

    public async getAPY(): Promise<number> {
        return 5.4;
    }

    // ---------------- Vault writes (simulated yield) ----------------

    public async depositToVault(amount: number): Promise<TransactionResult> {
        // Yield is simulated — moving liquid SOL into "vault shares" is a UI op.
        this.fallbackBaseShares += amount;
        return {
            success: true,
            txHash: randomTxHash(),
            message: `[DEMO] Deposited ${amount.toFixed(4)} SOL into Freedom Vault (simulated yield)`,
        };
    }

    public async redeemFromVault(amountShares: number): Promise<TransactionResult> {
        this.fallbackBaseShares = Math.max(0, this.fallbackBaseShares - amountShares);
        return {
            success: true,
            txHash: randomTxHash(),
            message: `[DEMO] Redeemed ${amountShares.toFixed(4)} vault shares back to liquid SOL`,
        };
    }

    // ---------------- Real transfers ----------------

    /**
     * Transfer SOL from the agent wallet to a base58 address.
     * Kept named `transferFrax` for source-compatibility with the EVM service.
     */
    public async transferFrax(toBase58: string, amount: number): Promise<TransactionResult> {
        if (this.remoteWrites) {
            try {
                const r = await fetch(solanaAgentApiUrl('vault'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'transferFrax',
                        toBase58,
                        amount,
                    }),
                });
                const j = (await r.json()) as TransactionResult & {
                    success?: boolean;
                    error?: string;
                };
                if (!r.ok || !j.success) {
                    return {
                        success: false,
                        txHash: '',
                        message: j.error || j.message || 'Transfer API falló',
                    };
                }
                return {
                    success: true,
                    txHash: j.txHash || '',
                    message: j.message || `Transferred ${amount.toFixed(4)} SOL`,
                    explorerUrl: j.explorerUrl,
                };
            } catch (err: any) {
                return {
                    success: false,
                    txHash: '',
                    message: err?.message ?? String(err),
                };
            }
        }
        if (!this.keypair) {
            return {
                success: true,
                txHash: randomTxHash(),
                message: `[DEMO] Transferred ${amount.toFixed(4)} SOL to ${toBase58.slice(0, 8)}...`,
            };
        }
        try {
            const toPk = new PublicKey(toBase58);
            const tx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: this.keypair.publicKey,
                    toPubkey: toPk,
                    lamports: Math.floor(amount * LAMPORTS_PER_SOL),
                }),
            );
            const sig = await sendAndConfirmTransaction(this.connection, tx, [this.keypair], {
                commitment: 'confirmed',
            });
            return {
                success: true,
                txHash: sig,
                message: `Transferred ${amount.toFixed(4)} SOL to ${toBase58.slice(0, 8)}...`,
                explorerUrl: `${DEFAULT_EXPLORER}/tx/${sig}${CLUSTER_QS}`,
            };
        } catch (err: any) {
            return {
                success: false,
                txHash: '',
                message: `Transfer failed: ${err?.message ?? err}`,
            };
        }
    }

    // ---------------- Evidence (delegated) ----------------

    public async storeEvidenceHash(
        hash: string,
        metadata?: string,
    ): Promise<TransactionResult> {
        if (this.remoteWrites) {
            try {
                const r = await fetch(solanaAgentApiUrl('memo'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ hash, metadata }),
                });
                const j = (await r.json()) as TransactionResult & {
                    success?: boolean;
                    error?: string;
                };
                if (!r.ok || !j.success) {
                    return {
                        success: false,
                        txHash: '',
                        message:
                            j.error ||
                            j.message ||
                            'API memo falló. Configura SOLANA_AGENT_KEYPAIR_BASE58 en Vercel.',
                    };
                }
                return {
                    success: true,
                    txHash: j.txHash || '',
                    message: j.message || 'Evidence hash stored on Solana (Memo Program)',
                    explorerUrl: j.explorerUrl,
                };
            } catch (err: any) {
                return {
                    success: false,
                    txHash: '',
                    message: err?.message ?? String(err),
                };
            }
        }
        if (!this.keypair) {
            return {
                success: false,
                txHash: '',
                message:
                    'Sin firma del agente: define VITE_SOLANA_KEYPAIR_BASE58 en local o SOLANA_AGENT_KEYPAIR_BASE58 en Vercel con rutas /api/solana/*. ',
            };
        }
        try {
            const sig = await storeEvidenceMemo(this.connection, this.keypair, hash, metadata);
            return {
                success: true,
                txHash: sig,
                message: 'Evidence hash stored on Solana (Memo Program)',
                explorerUrl: `${DEFAULT_EXPLORER}/tx/${sig}${CLUSTER_QS}`,
            };
        } catch (err: any) {
            const baseMsg = err?.message ?? String(err);
            const signerHint = this.keypair
                ? `signer=${this.keypair.publicKey.toBase58()}`
                : 'sin signer';
            console.error('[SolanaVault] storeEvidenceHash falló:', baseMsg, `(${signerHint})`);
            if (err instanceof SendTransactionError) {
                const logs = err.logs;
                if (logs?.length) {
                    console.error('[SolanaVault] logs simulación/envío (últimos):', logs.slice(-10));
                }
            }
            return {
                success: false,
                txHash: '',
                message: `Failed to store evidence: ${baseMsg}`,
            };
        }
    }

    // ---------------- SOS protocol ----------------

    /**
     * Emergency drain. Mirrors the EVM `triggerSOS`:
     *   1. "Liquidate" simulated vault shares back to liquid SOL (book-keeping only).
     *   2. Real transfer of the agent's SOL balance to the safe destination.
     */
    public async triggerSOS(destinationAddress: string): Promise<SOSResult> {
        const logs: string[] = ['[CRITICAL] INITIATING SOS PROTOCOL...'];
        const txHashes: string[] = [];

        const state = await this.getVaultState();
        logs.push(
            `Balance detected: ${state.fraxBalance.toFixed(4)} SOL + ${state.sFraxBalance.toFixed(2)} sim. shares`,
        );

        // Step 1: simulated liquidation
        if (state.sFraxBalance > 0) {
            logs.push('Liquidating simulated vault shares...');
            this.fallbackBaseShares = 0;
            txHashes.push(randomTxHash());
            logs.push(`[DEMO] Liquidation TX: ${txHashes[txHashes.length - 1].slice(0, 12)}...`);
        }

        // Step 2: real SOL transfer (leave a tiny dust to keep account alive)
        const dustLamports = 5000;
        let transferAmount = 0;
        if (this.keypair && this.isConnected) {
            transferAmount = Math.max(
                0,
                (await this.connection.getBalance(this.keypair.publicKey)) - dustLamports,
            );
        } else if (this.remoteWrites) {
            const pubStr = readSolanaAgentPubkeyEnv() || this.agentPubkeyCache || '';
            if (pubStr) {
                try {
                    const bal = await this.connection.getBalance(new PublicKey(pubStr));
                    transferAmount = Math.max(0, bal - dustLamports);
                } catch {
                    /* ignore */
                }
            }
        }
        const transferSol = transferAmount / LAMPORTS_PER_SOL;

        let destinationPk: PublicKey | null = null;
        try {
            destinationPk = new PublicKey(String(destinationAddress).trim());
        } catch {
            logs.push(
                '[Solana] El destino no es una dirección pública Solana válida: se omite el envío desde la wallet de respaldo. Los fondos del caso (si aplica) siguen el contacto seguro definido en el programa.',
            );
        }

        let apiTransferredSol = 0;

        if (this.remoteWrites && destinationPk) {
            try {
                const r = await fetch(solanaAgentApiUrl('vault'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'triggerSos',
                        destinationAddress: String(destinationAddress).trim(),
                    }),
                });
                const j = (await r.json()) as {
                    success?: boolean;
                    txHashes?: string[];
                    logs?: string[];
                    transferredAmount?: number;
                    error?: string;
                };
                if (Array.isArray(j.logs)) {
                    logs.push(...j.logs);
                }
                if (Array.isArray(j.txHashes)) {
                    txHashes.push(...j.txHashes);
                }
                apiTransferredSol = typeof j.transferredAmount === 'number' ? j.transferredAmount : 0;
                if (!r.ok || !j.success) {
                    logs.push(j.error || 'SOS API falló');
                    return {
                        success: false,
                        liquidatedAmount: state.sFraxBalance,
                        transferredAmount: 0,
                        destinationAddress,
                        txHashes,
                        logs,
                    };
                }
            } catch (err: any) {
                logs.push(`SOS API error: ${err?.message ?? err}`);
                return {
                    success: false,
                    liquidatedAmount: state.sFraxBalance,
                    transferredAmount: 0,
                    destinationAddress,
                    txHashes,
                    logs,
                };
            }
        } else if (this.keypair && transferAmount > 0 && destinationPk) {
            try {
                const tx = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: this.keypair.publicKey,
                        toPubkey: destinationPk,
                        lamports: transferAmount,
                    }),
                );
                const sig = await sendAndConfirmTransaction(this.connection, tx, [this.keypair], {
                    commitment: 'confirmed',
                });
                txHashes.push(sig);
                logs.push(`Transfer TX: ${sig.slice(0, 12)}...`);
            } catch (err: any) {
                logs.push(`Transfer failed: ${err?.message ?? err}`);
                return {
                    success: false,
                    liquidatedAmount: state.sFraxBalance,
                    transferredAmount: 0,
                    destinationAddress,
                    txHashes,
                    logs,
                };
            }
        } else {
            if (!this.remoteWrites && transferAmount <= 0) {
                logs.push('Sin saldo SOL transferible en la wallet de respaldo (tras reservar comisión mínima).');
            }
        }

        logs.push('SOS Protocol Complete. Funds secured.');

        const realTransferred = this.remoteWrites ? apiTransferredSol : transferSol;

        return {
            success: true,
            liquidatedAmount: state.sFraxBalance,
            transferredAmount: destinationPk ? realTransferred + state.sFraxBalance : state.sFraxBalance,
            destinationAddress,
            txHashes,
            logs,
        };
    }
}

// ============ SINGLETON ============

let instance: SolanaVaultService | null = null;

export const getSolanaVaultService = (): SolanaVaultService => {
    if (!instance) instance = new SolanaVaultService();
    return instance;
};

export default SolanaVaultService;
