/**
 * Carga la keypair del agente solo en entorno servidor (Vercel).
 *
 *   SOLANA_AGENT_KEYPAIR_BASE58 — preferido (no exponer como VITE_*)
 *   SOLANA_KEYPAIR_BASE58       — alias / scripts locales
 */

import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

export function loadSolanaAgentKeypair(): Keypair | null {
    const s =
        process.env.SOLANA_AGENT_KEYPAIR_BASE58?.trim() ||
        process.env.SOLANA_KEYPAIR_BASE58?.trim();
    if (!s) return null;
    try {
        return Keypair.fromSecretKey(bs58.decode(s));
    } catch (e) {
        console.warn('[api/solana] keypair inválida:', e);
        return null;
    }
}

export function getSolanaRpcUrlServer(): string {
    return (
        process.env.SOLANA_RPC_URL?.trim() ||
        process.env.VITE_SOLANA_RPC_URL?.trim() ||
        'https://api.devnet.solana.com'
    );
}

export function getSolanaProgramIdServer(): string | undefined {
    const p = process.env.SOLANA_PROGRAM_ID?.trim() || process.env.VITE_SOLANA_PROGRAM_ID?.trim();
    return p || undefined;
}
