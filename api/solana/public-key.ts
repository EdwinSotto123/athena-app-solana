/**
 * GET — pubkey del agente (derivada de la keypair en servidor).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { loadSolanaAgentKeypair } from './_load-agent';

export default function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    const kp = loadSolanaAgentKeypair();
    if (!kp) {
        return res.status(503).json({
            ok: false,
            error:
                'SOLANA_AGENT_KEYPAIR_BASE58 no configurada en el servidor (Vercel Environment Variables).',
        });
    }

    return res.status(200).json({ ok: true, pubkey: kp.publicKey.toBase58() });
}
