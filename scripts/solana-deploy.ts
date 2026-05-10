/**
 * scripts/solana-deploy.ts
 *
 * Wrapper around the Anchor CLI to:
 *   1. `anchor build` (inside ./solana)               (skip with --skip-build)
 *   2. `anchor deploy --provider.cluster devnet`     (skip with --skip-deploy)
 *   3. Sync the generated IDL into ./lib/_idl/athena_pool.json
 *   4. Initialize the Global PDA on first deploy     (force with --init-global)
 *
 * Requires the toolchain installed (see solana/SETUP.md). Use:
 *
 *     npm run sol:deploy
 *     npm run sol:deploy -- --skip-build --skip-deploy --init-global
 */

import dotenv from 'dotenv';
import { execSync } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    Transaction,
    VersionedTransaction,
} from '@solana/web3.js';
import bs58 from 'bs58';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';

class NodeWallet {
    payer: Keypair;
    constructor(payer: Keypair) {
        this.payer = payer;
    }
    get publicKey() {
        return this.payer.publicKey;
    }
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
        if ('version' in tx) (tx as VersionedTransaction).sign([this.payer]);
        else (tx as Transaction).partialSign(this.payer);
        return tx;
    }
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> {
        for (const tx of txs) await this.signTransaction(tx);
        return txs;
    }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT = resolve(__dirname, '..');
// Vite usa `.env.local`; `import 'dotenv/config'` solo carga `.env` en cwd.
dotenv.config({ path: join(ROOT, '.env') });
dotenv.config({ path: join(ROOT, '.env.local') });

const ANCHOR_DIR = join(ROOT, 'solana');
const IDL_SRC = join(ANCHOR_DIR, 'target', 'idl', 'athena_pool.json');
const IDL_DST = join(ROOT, 'lib', '_idl', 'athena_pool.json');

const argv = process.argv.slice(2);
const FLAGS = {
    skipBuild: argv.includes('--skip-build'),
    skipDeploy: argv.includes('--skip-deploy'),
    forceInitGlobal: argv.includes('--init-global'),
    skipInitGlobal: argv.includes('--skip-init-global'),
};

function run(cmd: string, cwd: string) {
    console.log(`\n$ ${cmd}`);
    execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, NO_DNA: '1' } });
}

async function main() {
    if (!existsSync(ANCHOR_DIR)) {
        console.error(`Anchor workspace not found at ${ANCHOR_DIR}`);
        process.exit(1);
    }

    if (FLAGS.skipBuild) {
        console.log('[build] skipped via --skip-build');
    } else {
        run('anchor build', ANCHOR_DIR);
    }

    if (FLAGS.skipDeploy) {
        console.log('[deploy] skipped via --skip-deploy');
    } else {
        run('anchor deploy --provider.cluster devnet', ANCHOR_DIR);
    }

    if (existsSync(IDL_SRC)) {
        mkdirSync(resolve(IDL_DST, '..'), { recursive: true });
        copyFileSync(IDL_SRC, IDL_DST);
        console.log(`IDL synced -> ${IDL_DST}`);
    } else {
        console.warn(`[idl] ${IDL_SRC} missing; skipping IDL sync`);
    }

    const idlPath = existsSync(IDL_DST) ? IDL_DST : IDL_SRC;
    if (!existsSync(idlPath)) {
        console.error('No IDL available; cannot continue with init.');
        process.exit(1);
    }

    const idl = JSON.parse(readFileSync(idlPath, 'utf8'));
    const programId: string = idl.address ?? process.env.VITE_SOLANA_PROGRAM_ID ?? '';
    if (!programId) {
        console.error('Could not determine program id (idl.address missing and VITE_SOLANA_PROGRAM_ID unset).');
        process.exit(1);
    }
    console.log(`\nProgram ID: ${programId}`);
    if (!FLAGS.skipDeploy) {
        console.log('Add the following to your .env.local:');
        console.log(`    VITE_SOLANA_PROGRAM_ID=${programId}`);
    }

    if (FLAGS.skipInitGlobal) {
        console.log('[init] Skipped via --skip-init-global.');
        return;
    }

    const secret = process.env.VITE_SOLANA_KEYPAIR_BASE58 || process.env.SOLANA_KEYPAIR_BASE58;
    if (!secret) {
        console.warn('\n[init] Skipping initialize_global: VITE_SOLANA_KEYPAIR_BASE58 not set.');
        return;
    }

    try {
        const rpc = process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
        const conn = new Connection(rpc, 'confirmed');
        const kp = Keypair.fromSecretKey(bs58.decode(secret));
        const provider = new AnchorProvider(conn, new NodeWallet(kp) as any, {
            commitment: 'confirmed',
        });
        const program = new Program(idl as Idl, provider);

        const [globalPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('global')],
            new PublicKey(programId),
        );

        const existing = await conn.getAccountInfo(globalPda);
        if (existing && !FLAGS.forceInitGlobal) {
            console.log(`[init] Global PDA already initialized at ${globalPda.toBase58()} — skipping.`);
            console.log('       Re-run with --init-global to attempt anyway.');
            return;
        }
        if (existing && FLAGS.forceInitGlobal) {
            console.log(`[init] Global PDA exists at ${globalPda.toBase58()} but --init-global was set; trying again.`);
        }

        const sig = await (program.methods as any)
            .initializeGlobal()
            .accounts({
                global: globalPda,
                admin: kp.publicKey,
                systemProgram: SystemProgram.programId,
            })
            .rpc();
        console.log(`[init] initialize_global tx: ${sig}`);
        console.log(`       Global PDA: ${globalPda.toBase58()}`);
        console.log(`       https://solscan.io/tx/${sig}?cluster=devnet`);
    } catch (err: any) {
        console.warn('[init] initialize_global failed:', err?.message ?? err);
    }
}

main().catch((err) => {
    console.error(err?.stack ?? err);
    process.exit(1);
});
