/**
 * AthenaPool Solana client.
 *
 * Mirror of `pool-service.ts` (Fraxtal) but talks to the Anchor program
 * `athena_pool` deployed on Solana Devnet.
 *
 * Funds donated to a case live as lamports inside the case PDA itself.
 * The PDA's data account stores metadata (owner, safe_contact, totals).
 */

import {
    AnchorProvider,
    Program,
    BN,
    Idl,
} from '@coral-xyz/anchor';
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    VersionedTransaction,
} from '@solana/web3.js';

/**
 * Minimal AnchorWallet implementation. The anchor browser bundle doesn't
 * export `Wallet`/`NodeWallet`, so we recreate the interface inline.
 */
class CustodialWallet {
    constructor(public readonly payer: Keypair) {}
    get publicKey(): PublicKey {
        return this.payer.publicKey;
    }
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
        if ('version' in tx) {
            (tx as VersionedTransaction).sign([this.payer]);
        } else {
            (tx as Transaction).partialSign(this.payer);
        }
        return tx;
    }
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
        for (const tx of txs) {
            await this.signTransaction(tx);
        }
        return txs;
    }
}
import bs58 from 'bs58';
import { v4 as uuidv4 } from 'uuid';
import idlJson from './_idl/athena_pool.json';
import { readSolanaAgentPubkeyEnv, solanaAgentApiUrl } from './solana-agent-api';

// ============ TYPES (mirror of pool-service.ts) ============

export interface PoolCaseInfo {
    caseId: string;
    owner: string;
    safeContact: string;
    balance: number;
    totalDonations: number;
    donorCount: number;
    isActive: boolean;
    createdAt: Date;
    donationUrl: string;
}

export interface SolanaTxResult {
    success: boolean;
    txHash: string;
    error?: string;
    explorerUrl?: string;
}

// ============ CONFIG ============

const DEFAULT_RPC = 'https://api.devnet.solana.com';
const DEFAULT_EXPLORER = 'https://solscan.io';
const CLUSTER_QS = '?cluster=devnet';

const CASE_SEED = Buffer.from('case');
const GLOBAL_SEED = Buffer.from('global');

// ============ HELPERS ============

/** UUID v4 hex without dashes -> [u8; 16] for the on-chain seed. */
export function caseIdToBytes(caseId: string): Uint8Array {
    const hex = caseId.replace(/-/g, '');
    if (hex.length !== 32) {
        throw new Error(`Invalid caseId: expected 32 hex chars, got ${hex.length}`);
    }
    const out = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return out;
}

/** Reverse: [u8; 16] -> uuid-style canonical string. */
export function bytesToCaseId(bytes: Uint8Array | number[]): string {
    const arr = Array.from(bytes);
    const hex = arr.map((b) => b.toString(16).padStart(2, '0')).join('');
    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20, 32),
    ].join('-');
}

type PoolEnvKey = 'SOLANA_RPC_URL' | 'SOLANA_KEYPAIR_BASE58' | 'SOLANA_PROGRAM_ID';

/** Opciones para instancias sólo-servidor (Vercel API) sin `import.meta.env` del browser. */
export type AthenaSolanaPoolClientOptions = {
    rpcUrl?: string;
    programId?: string;
    /** Secret key base58; nunca pasar desde el bundle del cliente. */
    keypairBase58?: string;
};

/** Vite requires static `import.meta.env.VITE_*` access; dynamic keys are empty in the client. */
function readEnv(key: PoolEnvKey): string | undefined {
    try {
        if (key === 'SOLANA_RPC_URL') {
            const v = import.meta.env.VITE_SOLANA_RPC_URL;
            if (v) return String(v).trim();
        }
        if (key === 'SOLANA_KEYPAIR_BASE58') {
            const v = import.meta.env.VITE_SOLANA_KEYPAIR_BASE58;
            if (v) return String(v).trim();
        }
        if (key === 'SOLANA_PROGRAM_ID') {
            const v = import.meta.env.VITE_SOLANA_PROGRAM_ID;
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
        if (key === 'SOLANA_PROGRAM_ID') {
            return (
                process.env.VITE_SOLANA_PROGRAM_ID?.trim() ?? process.env.SOLANA_PROGRAM_ID?.trim()
            );
        }
    }
    return undefined;
}

function loadKeypair(): Keypair | null {
    const secret = readEnv('SOLANA_KEYPAIR_BASE58');
    if (!secret) return null;
    try {
        return Keypair.fromSecretKey(bs58.decode(secret));
    } catch (err) {
        console.warn('[SolanaPool] Invalid SOLANA_KEYPAIR_BASE58:', err);
        return null;
    }
}

function loadKeypairFromSecret(secret: string | undefined): Keypair | null {
    if (secret == null || !String(secret).trim()) return null;
    try {
        return Keypair.fromSecretKey(bs58.decode(String(secret).trim()));
    } catch (err) {
        console.warn('[SolanaPool] Invalid keypair in options:', err);
        return null;
    }
}

// ============ POOL CLIENT ============

export class AthenaSolanaPoolClient {
    public readonly connection: Connection;
    public readonly programId: PublicKey | null;
    private wallet: CustodialWallet | null = null;
    private provider: AnchorProvider | null = null;
    private program: Program<Idl> | null = null;
    private idlLoaded = false;
    private isAdmin = false;
    /** En el navegador, sin VITE_SOLANA_KEYPAIR_BASE58: las escrituras van a /api/solana/pool */
    private readonly remoteWrites: boolean;
    private cachedRemotePubkey: string | null = null;

    constructor(options?: AthenaSolanaPoolClientOptions) {
        const rpcUrl = options?.rpcUrl ?? readEnv('SOLANA_RPC_URL') ?? DEFAULT_RPC;
        this.connection = new Connection(rpcUrl, 'confirmed');

        const programIdStr = options?.programId ?? readEnv('SOLANA_PROGRAM_ID');
        try {
            this.programId = programIdStr ? new PublicKey(programIdStr) : null;
        } catch {
            this.programId = null;
        }

        const keypair = options?.keypairBase58
            ? loadKeypairFromSecret(options.keypairBase58)
            : loadKeypair();
        if (keypair) {
            this.wallet = new CustodialWallet(keypair);
            this.provider = new AnchorProvider(
                this.connection,
                this.wallet as any,
                { commitment: 'confirmed', preflightCommitment: 'confirmed' },
            );
        }

        const isBrowser = typeof window !== 'undefined';
        this.remoteWrites = isBrowser && !this.wallet;
    }

    private async remotePoolCall(
        action: string,
        payload: Record<string, unknown>,
    ): Promise<SolanaTxResult & { amount?: number }> {
        try {
            const r = await fetch(solanaAgentApiUrl('pool'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, ...payload }),
            });
            const j = (await r.json()) as Record<string, unknown>;
            if (!r.ok) {
                return {
                    success: false,
                    txHash: '',
                    error: String(j.error || j.message || r.statusText),
                };
            }
            return {
                success: Boolean(j.success),
                txHash: String(j.txHash || ''),
                error: j.error != null ? String(j.error) : undefined,
                explorerUrl: j.explorerUrl != null ? String(j.explorerUrl) : undefined,
                amount: typeof j.amount === 'number' ? j.amount : undefined,
            };
        } catch (e: any) {
            return { success: false, txHash: '', error: e?.message ?? String(e) };
        }
    }

    /**
     * Pubkey del agente admin (wallet local, env público, o GET /api/solana/public-key).
     */
    public async resolveAgentPubkey(): Promise<string> {
        if (this.wallet) return this.wallet.publicKey.toBase58();
        const envPk = readSolanaAgentPubkeyEnv();
        if (envPk) return envPk;
        if (this.cachedRemotePubkey) return this.cachedRemotePubkey;
        try {
            const r = await fetch(solanaAgentApiUrl('public-key'));
            const j = (await r.json()) as { ok?: boolean; pubkey?: string };
            if (j.ok && j.pubkey) {
                this.cachedRemotePubkey = j.pubkey;
                return j.pubkey;
            }
        } catch {
            /* ignore */
        }
        return '';
    }

    public async prefetchRemoteAgentPubkey(): Promise<void> {
        await this.resolveAgentPubkey();
    }

    /** Provider solo lectura (fetch de cuentas; no firma transacciones). */
    private readonlyAnchorProvider(): AnchorProvider {
        const roWallet = {
            publicKey: SystemProgram.programId,
            signTransaction: async (t: Transaction) => t,
            signAllTransactions: async (ts: Transaction[]) => ts,
        };
        return new AnchorProvider(this.connection, roWallet as any, {
            commitment: 'confirmed',
            preflightCommitment: 'confirmed',
        });
    }

    /** Lazily fetches the on-chain IDL the first time we need the program. */
    private async ensureProgram(): Promise<Program<Idl> | null> {
        if (this.program) return this.program;
        if (!this.programId || !this.provider) return null;

        try {
            // Prefer on-chain IDL (always in sync with the deployed binary).
            const remoteIdl = await Program.fetchIdl(this.programId, this.provider);
            if (remoteIdl) {
                this.program = new Program(remoteIdl as Idl, this.provider);
                this.idlLoaded = true;
                console.log('[SolanaPool] Loaded on-chain IDL');
            } else {
                // Fallback to bundled stub. Will only work for read paths whose
                // accounts don't require account discriminators we don't have.
                this.program = new Program(idlJson as unknown as Idl, this.provider);
                console.warn('[SolanaPool] Using bundled IDL stub (program may not be deployed yet)');
            }
        } catch (err) {
            console.warn('[SolanaPool] Could not fetch IDL:', err);
            return null;
        }
        return this.program;
    }

    public isOnline(): boolean {
        return this.idlLoaded && this.program != null;
    }

    public getAddress(): string {
        return (
            this.wallet?.publicKey.toBase58() ??
            readSolanaAgentPubkeyEnv() ??
            this.cachedRemotePubkey ??
            ''
        );
    }

    public getProgramId(): string {
        return this.programId?.toBase58() ?? '';
    }

    public getExplorerUrl(): string {
        if (!this.programId) return DEFAULT_EXPLORER;
        return `${DEFAULT_EXPLORER}/account/${this.programId.toBase58()}${CLUSTER_QS}`;
    }

    public getDonationUrl(caseIdHex: string): string {
        if (!this.programId) return DEFAULT_EXPLORER;
        try {
            const [pda] = this.casePda(caseIdHex);
            return `${DEFAULT_EXPLORER}/account/${pda.toBase58()}${CLUSTER_QS}`;
        } catch {
            return DEFAULT_EXPLORER;
        }
    }

    public getShareableLink(caseIdHex: string, goalAmount?: number): string {
        const viteBase = (typeof import.meta !== 'undefined' && (import.meta as any).env?.BASE_URL) || '/';
        const normalizedBase = String(viteBase).replace(/\/$/, '');
        const origin =
            typeof window !== 'undefined' && window.location ? window.location.origin : '';
        const baseUrl = origin ? `${origin}${normalizedBase}` : 'https://athena-app.vercel.app';
        const params = new URLSearchParams({
            case: caseIdHex,
            program: this.programId?.toBase58() ?? '',
            cluster: 'devnet',
            chain: 'solana',
        });
        if (goalAmount) params.set('goal', goalAmount.toString());
        return `${baseUrl}/donate?${params.toString()}`;
    }

    // ---------------- PDA helpers ----------------

    public casePda(caseIdHex: string): [PublicKey, number] {
        if (!this.programId) {
            throw new Error('SOLANA_PROGRAM_ID is not configured');
        }
        return PublicKey.findProgramAddressSync(
            [CASE_SEED, Buffer.from(caseIdToBytes(caseIdHex))],
            this.programId,
        );
    }

    /** Case PDA for an explicit program id (donate deep-link `?program=`). */
    public static casePdaForProgram(caseIdHex: string, programId: PublicKey): [PublicKey, number] {
        return PublicKey.findProgramAddressSync(
            [CASE_SEED, Buffer.from(caseIdToBytes(caseIdHex))],
            programId,
        );
    }

    /**
     * Build an unsigned `donate` instruction tx for Phantom / browser wallets.
     * `programIdOverride` must be the same program that created the case on-chain.
     */
    public async buildDonateTransaction(
        caseIdHex: string,
        donorPk: PublicKey,
        amountSol: number,
        programIdOverride?: string,
    ): Promise<Transaction> {
        let pid: PublicKey;
        try {
            const raw = programIdOverride?.trim() || this.programId?.toBase58();
            if (!raw) throw new Error('missing');
            pid = new PublicKey(raw);
        } catch {
            throw new Error('Program ID inválido o no configurado (VITE_SOLANA_PROGRAM_ID).');
        }

        const readonlyWallet = {
            publicKey: donorPk,
            signTransaction: async (t: Transaction) => t,
            signAllTransactions: async (ts: Transaction[]) => ts,
        };
        const provider = new AnchorProvider(
            this.connection,
            readonlyWallet as any,
            { commitment: 'confirmed', preflightCommitment: 'confirmed' },
        );
        const program = new Program(idlJson as unknown as Idl, provider);
        const [casePk] = AthenaSolanaPoolClient.casePdaForProgram(caseIdHex, pid);
        const idBytes = Array.from(caseIdToBytes(caseIdHex));
        const lamports = new BN(Math.floor(amountSol * LAMPORTS_PER_SOL));
        if (lamports.lte(new BN(0))) {
            throw new Error('La cantidad en SOL debe ser mayor que 0.');
        }

        const tx = await program.methods
            .donate(idBytes, lamports)
            .accounts({
                case: casePk,
                donor: donorPk,
                systemProgram: SystemProgram.programId,
            })
            .transaction();
        return tx;
    }

    public globalPda(): [PublicKey, number] {
        if (!this.programId) {
            throw new Error('SOLANA_PROGRAM_ID is not configured');
        }
        return PublicKey.findProgramAddressSync([GLOBAL_SEED], this.programId);
    }

    /** Generates a fresh case ID (UUID v4 with dashes). */
    public generateCaseId(): string {
        return uuidv4();
    }

    /**
     * Lee la cuenta `Case` del programa indicado (p. ej. `programId` guardado en Firestore).
     * Usa el IDL empaquetado con la dirección sobreescrita para que Anchor resuelva el programa correcto.
     */
    public async getCaseInfoForProgram(
        caseIdHex: string,
        programPk: PublicKey,
    ): Promise<PoolCaseInfo | null> {
        const [pda] = AthenaSolanaPoolClient.casePdaForProgram(caseIdHex, programPk);
        const roProvider = this.readonlyAnchorProvider();
        const idlWithAddr = {
            ...(idlJson as Record<string, unknown>),
            address: programPk.toBase58(),
        } as Idl;
        try {
            const program = new Program(idlWithAddr, roProvider);
            const account: any = await (program.account as any).case.fetch(pda);

            const balanceLamports = await this.connection.getBalance(pda);
            const rentMin = await this.connection.getMinimumBalanceForRentExemption(100);
            const usableBalance = Math.max(0, balanceLamports - rentMin);

            return {
                caseId: caseIdHex,
                owner: account.owner.toBase58(),
                safeContact: account.safeContact.toBase58(),
                balance: usableBalance / LAMPORTS_PER_SOL,
                totalDonations: account.totalDonations.toNumber() / LAMPORTS_PER_SOL,
                donorCount: account.donationCount,
                isActive: account.isActive,
                createdAt: new Date(account.createdAt.toNumber() * 1000),
                donationUrl: `${DEFAULT_EXPLORER}/account/${pda.toBase58()}${CLUSTER_QS}`,
            };
        } catch (err) {
            console.warn('[SolanaPool] getCaseInfoForProgram failed:', caseIdHex, err);
            return null;
        }
    }

    public async getCaseInfo(caseIdHex: string): Promise<PoolCaseInfo | null> {
        if (!this.programId) return null;
        return this.getCaseInfoForProgram(caseIdHex, this.programId);
    }

    public async getCaseBalance(caseIdHex: string): Promise<number> {
        try {
            const [pda] = this.casePda(caseIdHex);
            const lamports = await this.connection.getBalance(pda);
            const rentMin = await this.connection.getMinimumBalanceForRentExemption(100);
            return Math.max(0, lamports - rentMin) / LAMPORTS_PER_SOL;
        } catch {
            return 0;
        }
    }

    public async caseExists(caseIdHex: string): Promise<boolean> {
        try {
            const [pda] = this.casePda(caseIdHex);
            const info = await this.connection.getAccountInfo(pda);
            return info != null;
        } catch {
            return false;
        }
    }

    // ---------------- Writes ----------------

    /** Creates a new case (admin signer). Mirrors `createCase` in Solidity. */
    public async createCase(
        caseIdHex: string,
        ownerBase58: string,
        safeContactBase58: string,
    ): Promise<SolanaTxResult> {
        if (this.remoteWrites) {
            return this.remotePoolCall('createCase', {
                caseIdHex,
                ownerBase58,
                safeContactBase58,
            });
        }
        const program = await this.ensureProgram();
        if (!program || !this.wallet) {
            return this.demoTx('createCase');
        }
        try {
            const [casePk] = this.casePda(caseIdHex);
            const [globalPk] = this.globalPda();
            const idBytes = Array.from(caseIdToBytes(caseIdHex));

            const sig = await (program.methods as any)
                .initializeCase(idBytes, new PublicKey(ownerBase58), new PublicKey(safeContactBase58))
                .accounts({
                    global: globalPk,
                    case: casePk,
                    admin: this.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            return {
                success: true,
                txHash: sig,
                explorerUrl: `${DEFAULT_EXPLORER}/tx/${sig}${CLUSTER_QS}`,
            };
        } catch (err: any) {
            return { success: false, txHash: '', error: err?.message ?? String(err) };
        }
    }

    /** Donate `amountSol` to a case. */
    public async donate(caseIdHex: string, amountSol: number): Promise<SolanaTxResult> {
        if (this.remoteWrites) {
            return this.remotePoolCall('donate', { caseIdHex, amountSol });
        }
        const program = await this.ensureProgram();
        if (!program || !this.wallet) {
            return this.demoTx('donate');
        }
        try {
            const [casePk] = this.casePda(caseIdHex);
            const idBytes = Array.from(caseIdToBytes(caseIdHex));
            const lamports = new BN(Math.floor(amountSol * LAMPORTS_PER_SOL));

            const sig = await (program.methods as any)
                .donate(idBytes, lamports)
                .accounts({
                    case: casePk,
                    donor: this.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();

            return {
                success: true,
                txHash: sig,
                explorerUrl: `${DEFAULT_EXPLORER}/tx/${sig}${CLUSTER_QS}`,
            };
        } catch (err: any) {
            return { success: false, txHash: '', error: err?.message ?? String(err) };
        }
    }

    /** Owner withdraws `amountSol` from the case PDA. */
    public async withdraw(caseIdHex: string, amountSol: number): Promise<SolanaTxResult> {
        if (this.remoteWrites) {
            return this.remotePoolCall('withdraw', { caseIdHex, amountSol });
        }
        const program = await this.ensureProgram();
        if (!program || !this.wallet) {
            return this.demoTx('withdraw');
        }
        try {
            const [casePk] = this.casePda(caseIdHex);
            const idBytes = Array.from(caseIdToBytes(caseIdHex));
            const lamports = new BN(Math.floor(amountSol * LAMPORTS_PER_SOL));

            const sig = await (program.methods as any)
                .withdraw(idBytes, lamports)
                .accounts({
                    case: casePk,
                    owner: this.wallet.publicKey,
                })
                .rpc();

            return {
                success: true,
                txHash: sig,
                explorerUrl: `${DEFAULT_EXPLORER}/tx/${sig}${CLUSTER_QS}`,
            };
        } catch (err: any) {
            return { success: false, txHash: '', error: err?.message ?? String(err) };
        }
    }

    /**
     * Atomic SOS: drains the entire case to its registered safe_contact.
     * Mirrors `triggerSOS` in Solidity but executed in a single Solana tx.
     */
    public async triggerSOS(
        caseIdHex: string,
    ): Promise<{ success: boolean; txHash: string; amount?: number; error?: string }> {
        if (this.remoteWrites) {
            const r = await this.remotePoolCall('triggerSos', { caseIdHex });
            return {
                success: r.success,
                txHash: r.txHash,
                amount: r.amount,
                error: r.error,
            };
        }
        const program = await this.ensureProgram();
        if (!program || !this.wallet) {
            const demo = this.demoTx('triggerSOS');
            return { ...demo, amount: 0 };
        }
        try {
            const [casePk] = this.casePda(caseIdHex);
            const idBytes = Array.from(caseIdToBytes(caseIdHex));

            const account: any = await (program.account as any).case.fetch(casePk);
            const safeContactPk = account.safeContact as PublicKey;
            const balanceBefore = await this.getCaseBalance(caseIdHex);

            const sig = await (program.methods as any)
                .triggerSos(idBytes)
                .accounts({
                    case: casePk,
                    owner: this.wallet.publicKey,
                    safeContact: safeContactPk,
                })
                .rpc();

            return { success: true, txHash: sig, amount: balanceBefore };
        } catch (err: any) {
            return { success: false, txHash: '', error: err?.message ?? String(err) };
        }
    }

    /** Owner updates the safe_contact pubkey for a case. */
    public async setSafeContact(
        caseIdHex: string,
        newContactBase58: string,
    ): Promise<SolanaTxResult> {
        if (this.remoteWrites) {
            return this.remotePoolCall('setSafeContact', { caseIdHex, newContactBase58 });
        }
        const program = await this.ensureProgram();
        if (!program || !this.wallet) {
            return this.demoTx('setSafeContact');
        }
        try {
            const [casePk] = this.casePda(caseIdHex);
            const idBytes = Array.from(caseIdToBytes(caseIdHex));

            const sig = await (program.methods as any)
                .setSafeContact(idBytes, new PublicKey(newContactBase58))
                .accounts({
                    case: casePk,
                    owner: this.wallet.publicKey,
                })
                .rpc();

            return {
                success: true,
                txHash: sig,
                explorerUrl: `${DEFAULT_EXPLORER}/tx/${sig}${CLUSTER_QS}`,
            };
        } catch (err: any) {
            return { success: false, txHash: '', error: err?.message ?? String(err) };
        }
    }

    /** First-time deployment helper: initialize the global PDA (admin = signer). */
    public async initializeGlobal(): Promise<SolanaTxResult> {
        if (this.remoteWrites) {
            return this.remotePoolCall('initializeGlobal', {});
        }
        const program = await this.ensureProgram();
        if (!program || !this.wallet) {
            return this.demoTx('initializeGlobal');
        }
        try {
            const [globalPk] = this.globalPda();
            const sig = await (program.methods as any)
                .initializeGlobal()
                .accounts({
                    global: globalPk,
                    admin: this.wallet.publicKey,
                    systemProgram: SystemProgram.programId,
                })
                .rpc();
            return {
                success: true,
                txHash: sig,
                explorerUrl: `${DEFAULT_EXPLORER}/tx/${sig}${CLUSTER_QS}`,
            };
        } catch (err: any) {
            return { success: false, txHash: '', error: err?.message ?? String(err) };
        }
    }

    /** Mirrors the `[DEMO]` fake-tx pattern of the EVM service. */
    private demoTx(label: string): SolanaTxResult {
        const fake =
            'demo_' +
            Array(58)
                .fill(0)
                .map(() =>
                    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789'.charAt(
                        Math.floor(Math.random() * 57),
                    ),
                )
                .join('');
        console.log(`[SolanaPool][DEMO] simulated ${label}`);
        return { success: true, txHash: fake };
    }
}

// ============ SINGLETON ============

let instance: AthenaSolanaPoolClient | null = null;

export const getSolanaPoolClient = (): AthenaSolanaPoolClient => {
    if (!instance) instance = new AthenaSolanaPoolClient();
    return instance;
};

export default AthenaSolanaPoolClient;
