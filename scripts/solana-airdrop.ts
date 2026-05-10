/**
 * scripts/solana-airdrop.ts
 *
 * Convenience script: request a Devnet airdrop for the agent's
 * custodial wallet (`VITE_SOLANA_KEYPAIR_BASE58`) and print the new
 * balance. Run with:
 *
 *     npm run sol:airdrop -- 2     # 2 SOL (default)
 *
 * Devnet airdrop is rate-limited; if it fails, retry after a few
 * seconds or use https://faucet.solana.com.
 */

import dotenv from 'dotenv';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: join(ROOT, '.env') });
dotenv.config({ path: join(ROOT, '.env.local') });

const RPC = process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
const SECRET = process.env.VITE_SOLANA_KEYPAIR_BASE58 || process.env.SOLANA_KEYPAIR_BASE58;

async function main() {
    if (!SECRET) {
        console.error('Missing VITE_SOLANA_KEYPAIR_BASE58 in .env.local');
        process.exit(1);
    }

    const amount = Number(process.argv[2] ?? 2);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 5) {
        console.error('Amount must be a number between 0 and 5 SOL (Devnet cap).');
        process.exit(1);
    }

    const kp = Keypair.fromSecretKey(bs58.decode(SECRET));
    const conn = new Connection(RPC, 'confirmed');
    const pk: PublicKey = kp.publicKey;

    const before = await conn.getBalance(pk);
    console.log(`Wallet:  ${pk.toBase58()}`);
    console.log(`RPC:     ${RPC}`);
    console.log(`Balance before: ${(before / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

    console.log(`Requesting ${amount} SOL airdrop...`);
    const sig = await conn.requestAirdrop(pk, Math.floor(amount * LAMPORTS_PER_SOL));

    const latest = await conn.getLatestBlockhash('confirmed');
    await conn.confirmTransaction(
        { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
        'confirmed',
    );

    const after = await conn.getBalance(pk);
    console.log(`Balance after:  ${(after / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
    console.log(`Tx: https://solscan.io/tx/${sig}?cluster=devnet`);
}

main().catch((err) => {
    console.error('Airdrop failed:', err?.message ?? err);
    process.exit(1);
});
