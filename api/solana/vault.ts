/**
 * POST — transferencias SOL y SOS desde la wallet del agente (firma servidor).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
    Connection,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import { getSolanaRpcUrlServer, loadSolanaAgentKeypair } from './_load-agent';

const CLUSTER_QS = '?cluster=devnet';
const EXPLORER = 'https://solscan.io';

interface Body {
    action?: 'transferFrax' | 'triggerSos';
    toBase58?: string;
    amount?: number;
    destinationAddress?: string;
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
            error: 'SOLANA_AGENT_KEYPAIR_BASE58 no configurada en servidor.',
        });
    }

    const body: Body = req.body || {};
    const rpc = getSolanaRpcUrlServer();
    const connection = new Connection(rpc, 'confirmed');

    try {
        if (body.action === 'transferFrax') {
            const to = body.toBase58?.trim();
            const amount = body.amount ?? 0;
            if (!to) {
                return res.status(400).json({ success: false, error: 'toBase58 requerido' });
            }
            const toPk = new PublicKey(to);
            const tx = new Transaction().add(
                SystemProgram.transfer({
                    fromPubkey: kp.publicKey,
                    toPubkey: toPk,
                    lamports: Math.floor(amount * LAMPORTS_PER_SOL),
                }),
            );
            const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
                commitment: 'confirmed',
            });
            return res.status(200).json({
                success: true,
                txHash: sig,
                message: `Transferred ${amount.toFixed(4)} SOL`,
                explorerUrl: `${EXPLORER}/tx/${sig}${CLUSTER_QS}`,
            });
        }

        if (body.action === 'triggerSos') {
            const dest = body.destinationAddress?.trim();
            if (!dest) {
                return res.status(400).json({ success: false, error: 'destinationAddress requerido' });
            }
            const dustLamports = 5000;
            const balance = await connection.getBalance(kp.publicKey);
            const transferAmount = Math.max(0, balance - dustLamports);
            let destPk: PublicKey;
            try {
                destPk = new PublicKey(dest);
            } catch {
                return res.status(400).json({ success: false, error: 'destinationAddress inválida' });
            }

            const txHashes: string[] = [];
            const logs: string[] = ['[CRITICAL] SOS (servidor): evacuando SOL del agente'];

            if (transferAmount > 0) {
                const tx = new Transaction().add(
                    SystemProgram.transfer({
                        fromPubkey: kp.publicKey,
                        toPubkey: destPk,
                        lamports: transferAmount,
                    }),
                );
                const sig = await sendAndConfirmTransaction(connection, tx, [kp], {
                    commitment: 'confirmed',
                });
                txHashes.push(sig);
                logs.push(`Transfer TX: ${sig.slice(0, 12)}...`);
            } else {
                logs.push('Sin saldo transferible (tras reservar comisión mínima).');
            }

            return res.status(200).json({
                success: true,
                transferredAmount: transferAmount / LAMPORTS_PER_SOL,
                destinationAddress: dest,
                txHashes,
                logs,
            });
        }

        return res.status(400).json({ success: false, error: 'action inválida' });
    } catch (e: unknown) {
        console.error('[api/solana/vault]', e);
        return res.status(500).json({
            success: false,
            error: e instanceof Error ? e.message : 'Error',
        });
    }
}
