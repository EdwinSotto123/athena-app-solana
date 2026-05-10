/**
 * Escribe un resumen de despliegue Solana (programa, PDA global, wallet del
 * agente, RPC, enlaces a Solscan) en un archivo de texto.
 *
 * Uso:
 *   npm run sol:info
 *   npm run sol:info -- --out=./mi-resumen.txt
 *   npm run sol:info -- --secret   # incluye VITE_SOLANA_KEYPAIR_BASE58 (¡riesgo!)
 *
 * NUNCA subas a git un .txt generado con --secret.
 */

import dotenv from 'dotenv';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
dotenv.config({ path: join(ROOT, '.env') });
dotenv.config({ path: join(ROOT, '.env.local') });

const MEMO_PROGRAM_ID = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

const argv = process.argv.slice(2);
const includeSecret = argv.includes('--secret') || argv.includes('--full');
const outFromFlag = argv.find((a) => a.startsWith('--out='));
const outPath = outFromFlag
    ? resolve(ROOT, outFromFlag.replace(/^--out=/, ''))
    : join(ROOT, 'solana-deployment-notes.txt');

function clusterFromRpc(rpc: string): string {
    if (rpc.includes('devnet')) return 'devnet';
    if (rpc.includes('mainnet') || rpc.includes('api.mainnet')) return 'mainnet-beta';
    if (rpc.includes('testnet')) return 'testnet';
    return 'custom';
}

async function main() {
    const rpc = process.env.VITE_SOLANA_RPC_URL || 'https://api.devnet.solana.com';
    const cluster = clusterFromRpc(rpc);

    let programIdStr =
        process.env.VITE_SOLANA_PROGRAM_ID?.trim() ||
        process.env.SOLANA_PROGRAM_ID?.trim() ||
        '';

    const idlPath = join(ROOT, 'lib', '_idl', 'athena_pool.json');
    if (!programIdStr && existsSync(idlPath)) {
        const idl = JSON.parse(readFileSync(idlPath, 'utf8')) as { address?: string };
        programIdStr = idl.address ?? '';
    }

    if (!programIdStr) {
        console.error(
            'No hay Program ID: define VITE_SOLANA_PROGRAM_ID o genera lib/_idl/athena_pool.json',
        );
        process.exit(1);
    }

    const programPk = new PublicKey(programIdStr);
    const [globalPda] = PublicKey.findProgramAddressSync([Buffer.from('global')], programPk);

    const secret =
        process.env.VITE_SOLANA_KEYPAIR_BASE58 || process.env.SOLANA_KEYPAIR_BASE58;

    let walletAddress = '';
    let balanceSol = '';
    if (secret) {
        const kp = Keypair.fromSecretKey(bs58.decode(secret));
        walletAddress = kp.publicKey.toBase58();
        try {
            const conn = new Connection(rpc, 'confirmed');
            const lamports = await conn.getBalance(kp.publicKey);
            balanceSol = (lamports / LAMPORTS_PER_SOL).toFixed(4);
        } catch {
            balanceSol = '(no se pudo leer)';
        }
    }

    const solscan = (path: string) =>
        `https://solscan.io${path}${cluster === 'devnet' ? '?cluster=devnet' : cluster === 'testnet' ? '?cluster=testnet' : ''}`;

    const lines: string[] = [
        '================================================================================',
        '  Athena — notas de despliegue Solana (generado automáticamente)',
        '================================================================================',
        `Fecha (local): ${new Date().toISOString()}`,
        '',
        '--- Red ---',
        `VITE_CHAIN:     ${process.env.VITE_CHAIN ?? '(no definido en .env.local)'}`,
        `RPC:            ${rpc}`,
        `Cluster:        ${cluster}`,
        '',
        '--- Programa Anchor (pool / “contrato”) ---',
        `Program ID:     ${programIdStr}`,
        `  Explorador:   ${solscan(`/account/${programIdStr}`)}`,
        '',
        '--- PDA Global (estado compartido del pool) ---',
        `Global PDA:     ${globalPda.toBase58()}`,
        `  (seeds: [b"global"] bajo el Program ID de arriba)`,
        `  Explorador:   ${solscan(`/account/${globalPda.toBase58()}`)}`,
        '',
        '--- Wallet del agente (firma transacciones custodiales) ---',
        `Dirección:      ${walletAddress || '(falta VITE_SOLANA_KEYPAIR_BASE58 en .env.local)'}`,
        `Saldo aprox.:   ${balanceSol ? `${balanceSol} SOL` : '—'}`,
        walletAddress
            ? `  Explorador:   ${solscan(`/account/${walletAddress}`)}`
            : '',
        '',
        '--- Otros programas usados en la app ---',
        `SPL Memo:       ${MEMO_PROGRAM_ID}  (evidencia on-chain)`,
        `  Explorador:   ${solscan(`/account/${MEMO_PROGRAM_ID}`)}`,
        '',
        '--- Archivos útiles en el repo ---',
        `IDL (cliente):  ${join(ROOT, 'lib', '_idl', 'athena_pool.json')}`,
        `Keypair deploy: solana/target/deploy/athena_pool-keypair.json  (reservado; no compartir)`,
        `Workspace:      solana/`,
        '',
        '--- Comandos de referencia ---',
        '  npm run sol:airdrop        # fondear el wallet del agente en Devnet',
        '  npm run sol:sync-idl      # copiar IDL desde solana/target/idl',
        '  npm run sol:info          # volver a generar este archivo',
    ];

    if (includeSecret && secret) {
        lines.push(
            '',
            '>>> SECCIÓN SENSIBLE — NO SUBAS ESTE ARCHIVO A GIT NI LO COMPARTAS <<<',
            '',
            'VITE_SOLANA_KEYPAIR_BASE58 (secreto completo en base58):',
            secret,
            '',
        );
    } else if (includeSecret && !secret) {
        lines.push(
            '',
            '(Pediste --secret pero no hay VITE_SOLANA_KEYPAIR_BASE58 en .env.local)',
        );
    } else {
        lines.push(
            '',
            '--- Clave privada del agente ---',
            'No se incluyó en este archivo. Para añadirla (última fila, riesgo de fuga):',
            '  npm run sol:info -- --secret',
        );
    }

    lines.push('================================================================================', '');

    const text = lines.join('\n') + '\n';
    writeFileSync(outPath, text, 'utf8');
    console.log(`Escrito: ${outPath}`);
    if (includeSecret) {
        console.warn(
            '\n[!] El archivo contiene el secreto. Guárdalo solo en un sitio seguro; no lo commitees.',
        );
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
