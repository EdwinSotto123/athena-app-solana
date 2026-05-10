/**
 * Rutas del agente Solana firmadas en servidor (/api/solana/*).
 * La secret key debe vivir solo en Vercel: SOLANA_AGENT_KEYPAIR_BASE58 (sin VITE_).
 */

export function solanaAgentApiUrl(segment: string): string {
    const clean = segment.replace(/^\//, '').replace(/\/$/, '');
    let base = '';
    try {
        const b = (import.meta as unknown as { env?: Record<string, string> }).env
            ?.VITE_SOLANA_AGENT_API_BASE?.trim();
        if (b) base = String(b).replace(/\/$/, '');
    } catch {
        /* ignore */
    }
    if (base) return `${base}/${clean}`;
    return `/api/solana/${clean}`;
}

export function readSolanaAgentPubkeyEnv(): string {
    try {
        const v = import.meta.env.VITE_SOLANA_AGENT_PUBKEY;
        return v ? String(v).trim() : '';
    } catch {
        return '';
    }
}
