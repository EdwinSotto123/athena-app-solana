/**
 * POST — anclar evidencia vía SPL Memo (firma servidor).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Connection } from '@solana/web3.js';
import { storeEvidenceMemo } from '../../lib/solana-evidence-service';
import { getSolanaRpcUrlServer, loadSolanaAgentKeypair } from './_load-agent';

const CLUSTER_QS = '?cluster=devnet';
const EXPLORER = 'https://solscan.io';

interface Body {
    hash?: string;
    metadata?: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    const kp = loadSolanaAgentKeypair();
    if (!kp) {
        return res.status(503).json({
            success: false,
            error:
                'SOLANA_AGENT_KEYPAIR_BASE58 no configurada. Añádela en Vercel (sin prefijo VITE_).',
        });
    }

    const { hash, metadata }: Body = req.body || {};
    if (!hash || typeof hash !== 'string') {
        return res.status(400).json({ success: false, error: 'hash es requerido' });
    }

    const rpc = getSolanaRpcUrlServer();
    const connection = new Connection(rpc, 'confirmed');

    try {
        const sig = await storeEvidenceMemo(connection, kp, hash, metadata);
        return res.status(200).json({
            success: true,
            txHash: sig,
            message: 'Evidence hash stored on Solana (Memo Program)',
            explorerUrl: `${EXPLORER}/tx/${sig}${CLUSTER_QS}`,
        });
    } catch (e: unknown) {
        console.error('[api/solana/memo]', e);
        return res.status(500).json({
            success: false,
            txHash: '',
            error: e instanceof Error ? e.message : 'Error al enviar memo',
        });
    }
}
