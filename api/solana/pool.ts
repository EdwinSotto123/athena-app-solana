/**
 * POST — escrituras AthenaPool con firma del agente admin (servidor).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import AthenaSolanaPoolClient from '../../lib/solana-pool-client';
import { getSolanaProgramIdServer, getSolanaRpcUrlServer } from './_load-agent';

interface Body {
    action?:
        | 'createCase'
        | 'triggerSos'
        | 'donate'
        | 'withdraw'
        | 'setSafeContact'
        | 'initializeGlobal';
    caseIdHex?: string;
    ownerBase58?: string;
    safeContactBase58?: string;
    amountSol?: number;
    newContactBase58?: string;
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

    const secret =
        process.env.SOLANA_AGENT_KEYPAIR_BASE58?.trim() ||
        process.env.SOLANA_KEYPAIR_BASE58?.trim();
    if (!secret) {
        return res.status(503).json({
            success: false,
            error:
                'SOLANA_AGENT_KEYPAIR_BASE58 no configurada en Vercel (sin VITE_*).',
        });
    }

    const programId = getSolanaProgramIdServer();
    if (!programId) {
        return res.status(503).json({
            success: false,
            error: 'SOLANA_PROGRAM_ID / VITE_SOLANA_PROGRAM_ID no configurado en servidor.',
        });
    }

    const body: Body = req.body || {};
    const action = body.action;
    if (!action) {
        return res.status(400).json({ success: false, error: 'action requerida' });
    }

    const client = new AthenaSolanaPoolClient({
        rpcUrl: getSolanaRpcUrlServer(),
        programId,
        keypairBase58: secret,
    });

    if (!client.getAddress()) {
        return res.status(500).json({
            success: false,
            error: 'SOLANA_AGENT_KEYPAIR_BASE58 no es una secret key base58 válida',
        });
    }

    try {
        switch (action) {
            case 'createCase': {
                const { caseIdHex, ownerBase58, safeContactBase58 } = body;
                if (!caseIdHex || !ownerBase58 || !safeContactBase58) {
                    return res.status(400).json({
                        success: false,
                        error: 'createCase requiere caseIdHex, ownerBase58, safeContactBase58',
                    });
                }
                const r = await client.createCase(caseIdHex, ownerBase58, safeContactBase58);
                return res.status(r.success ? 200 : 400).json({
                    ...r,
                    amount: undefined,
                });
            }
            case 'triggerSos': {
                const { caseIdHex } = body;
                if (!caseIdHex) {
                    return res.status(400).json({ success: false, error: 'caseIdHex requerido' });
                }
                const r = await client.triggerSOS(caseIdHex);
                return res.status(r.success ? 200 : 400).json({
                    success: r.success,
                    txHash: r.txHash,
                    error: r.error,
                    explorerUrl: r.success
                        ? `https://solscan.io/tx/${r.txHash}?cluster=devnet`
                        : undefined,
                    amount: r.amount,
                });
            }
            case 'donate': {
                const { caseIdHex, amountSol } = body;
                if (!caseIdHex || amountSol == null) {
                    return res.status(400).json({
                        success: false,
                        error: 'donate requiere caseIdHex y amountSol',
                    });
                }
                const r = await client.donate(caseIdHex, amountSol);
                return res.status(r.success ? 200 : 400).json(r);
            }
            case 'withdraw': {
                const { caseIdHex, amountSol } = body;
                if (!caseIdHex || amountSol == null) {
                    return res.status(400).json({
                        success: false,
                        error: 'withdraw requiere caseIdHex y amountSol',
                    });
                }
                const r = await client.withdraw(caseIdHex, amountSol);
                return res.status(r.success ? 200 : 400).json(r);
            }
            case 'setSafeContact': {
                const { caseIdHex, newContactBase58 } = body;
                if (!caseIdHex || !newContactBase58) {
                    return res.status(400).json({
                        success: false,
                        error: 'setSafeContact requiere caseIdHex y newContactBase58',
                    });
                }
                const r = await client.setSafeContact(caseIdHex, newContactBase58);
                return res.status(r.success ? 200 : 400).json(r);
            }
            case 'initializeGlobal': {
                const r = await client.initializeGlobal();
                return res.status(r.success ? 200 : 400).json(r);
            }
            default:
                return res.status(400).json({ success: false, error: 'action desconocida' });
        }
    } catch (e: unknown) {
        console.error('[api/solana/pool]', e);
        return res.status(500).json({
            success: false,
            error: e instanceof Error ? e.message : 'Error',
        });
    }
}
