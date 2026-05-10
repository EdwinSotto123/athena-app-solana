/**
 * On-Chain Identity Card
 * ----------------------
 * Read-only card surfaced inside the Vault when running in Solana mode.
 * Shows the Anchor program, Global PDA, agent wallet (with live SOL
 * balance) and RPC endpoint, each linking to Solscan.
 *
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Activity, Brain, Copy, ExternalLink, Wallet as WalletIcon } from 'lucide-react';
import { getExplorer, truncateAddress } from '../lib/chain-router';
import { getSolanaPoolClient } from '../lib/solana-pool-client';
import { getSolanaVaultService } from '../lib/solana-vault-service';
import { getAiBackendInfo } from '../services/geminiService';

interface RowProps {
    label: string;
    value: string;
    href?: string;
    mono?: boolean;
}

const Row: React.FC<RowProps> = ({ label, value, href, mono = true }) => {
    const handleCopy = () => {
        if (!value) return;
        navigator.clipboard.writeText(value).catch(() => {});
    };

    return (
        <div className="flex items-center justify-between gap-3 py-2 border-b border-neutral-800/60 last:border-b-0">
            <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                    {label}
                </p>
                <p className={`text-sm text-gray-200 truncate ${mono ? 'font-mono' : ''}`}>
                    {value || '—'}
                </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
                {value && (
                    <button
                        onClick={handleCopy}
                        title="Copy"
                        className="p-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-gray-400 hover:text-white transition"
                    >
                        <Copy className="w-3.5 h-3.5" />
                    </button>
                )}
                {href && (
                    <a
                        href={href}
                        target="_blank"
                        rel="noreferrer"
                        title="Open in explorer"
                        className="p-1.5 rounded-md bg-neutral-800 hover:bg-neutral-700 text-gray-400 hover:text-white transition"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                )}
            </div>
        </div>
    );
};

export const OnChainIdentityCard: React.FC = () => {
    const pool = useMemo(() => getSolanaPoolClient(), []);
    const vault = useMemo(() => getSolanaVaultService(), []);
    const explorer = getExplorer();

    const programId = pool.getProgramId();
    const agentWallet = vault.getAddress();
    const network = vault.getNetworkInfo();

    const globalPda = useMemo(() => {
        try {
            return programId ? pool.globalPda()[0].toBase58() : '';
        } catch {
            return '';
        }
    }, [pool, programId]);

    const [balanceSol, setBalanceSol] = useState<number | null>(null);

    useEffect(() => {
        let cancelled = false;
        const tick = async () => {
            try {
                const state = await vault.getVaultState();
                if (!cancelled) setBalanceSol(state.fraxBalance);
            } catch {
                if (!cancelled) setBalanceSol(null);
            }
        };
        tick();
        const id = setInterval(tick, 30000);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [vault]);

    return (
        <div className="bg-neutral-900/50 p-5 rounded-3xl border border-neutral-800">
            <div className="flex items-center justify-between mb-3 ml-1">
                <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-purple-400" />
                    <h4 className="text-gray-400 text-xs uppercase tracking-wider font-bold">
                        On-Chain Identity
                    </h4>
                </div>
                <span className="text-[10px] font-mono text-purple-300 bg-purple-500/10 border border-purple-500/30 rounded-full px-2 py-0.5">
                    SOLANA DEVNET
                </span>
            </div>

            <Row
                label="Program (Anchor)"
                value={programId ? truncateAddress(programId, 8, 8) : ''}
                href={programId ? explorer.addressUrl(programId) : undefined}
            />
            <Row
                label="Global PDA"
                value={globalPda ? truncateAddress(globalPda, 8, 8) : ''}
                href={globalPda ? explorer.addressUrl(globalPda) : undefined}
            />
            <Row
                label="Agent wallet"
                value={agentWallet ? truncateAddress(agentWallet, 8, 8) : ''}
                href={agentWallet ? explorer.addressUrl(agentWallet) : undefined}
            />

            <div className="flex items-center justify-between gap-3 py-2 border-b border-neutral-800/60">
                <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold">
                        Live balance
                    </p>
                    <p className="text-sm text-gray-200 font-mono">
                        {balanceSol == null ? '—' : `${balanceSol.toFixed(4)} SOL`}
                    </p>
                </div>
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-purple-500/10 text-purple-300">
                    <WalletIcon className="w-4 h-4" />
                </div>
            </div>

            <Row label="RPC endpoint" value={network.rpcUrl} mono={false} />

            <AiBackendRow />
        </div>
    );
};

const AiBackendRow: React.FC = () => {
    const info = getAiBackendInfo();
    const status = info.endpointConfigured
        ? 'Vertex AI · Cloud Function'
        : info.hasLegacyKey
            ? 'Browser Gemini (legacy)'
            : 'Offline (canned replies)';
    const badgeClass = info.endpointConfigured
        ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/30'
        : info.hasLegacyKey
            ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
            : 'text-gray-400 bg-neutral-800 border-neutral-700';

    let endpointLabel = '';
    try {
        endpointLabel = info.endpoint ? new URL(info.endpoint).host : '';
    } catch {
        endpointLabel = info.endpoint || '';
    }

    return (
        <div className="flex items-center justify-between gap-3 pt-3 mt-1 border-t border-neutral-800/80">
            <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-gray-500 font-semibold flex items-center gap-1">
                    <Brain className="w-3 h-3" />
                    AI Backend
                </p>
                <p className="text-sm text-gray-200 font-mono truncate">
                    {endpointLabel || (info.hasLegacyKey ? 'aistudio.google.com' : 'none')}
                </p>
            </div>
            <span className={`text-[10px] font-mono border rounded-full px-2 py-0.5 ${badgeClass}`}>
                {status}
            </span>
        </div>
    );
};

export default OnChainIdentityCard;
