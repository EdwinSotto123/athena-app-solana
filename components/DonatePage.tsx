/**
 * Donaciones públicas: marketplace + donar por Case ID (instrucción Anchor donate).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { ExternalLink, LayoutGrid, Loader2, Target, Wallet } from 'lucide-react';
import { getExplorer } from '../lib/chain-router';
import { AthenaSolanaPoolClient, getSolanaPoolClient, type PoolCaseInfo } from '../lib/solana-pool-client';
import { fetchSolUsd } from '../lib/sol-price';
import {
  auth,
  escapePlanToCaseListing,
  getCaseListing,
  listActiveCaseListings,
  loadEscapePlan,
  type CaseListing,
} from '../lib/firebase';
import { formatPlanMoney } from '../lib/plan-currency';
import { onAuthStateChanged } from 'firebase/auth';

type PhantomLike = {
  isPhantom?: boolean;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: PublicKey }>;
  disconnect?: () => Promise<void>;
  publicKey: PublicKey | null;
  signTransaction: (tx: import('@solana/web3.js').Transaction) => Promise<import('@solana/web3.js').Transaction>;
};

function getPhantom(): PhantomLike | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { solana?: PhantomLike };
  return w.solana ?? null;
}

function readParams(): { caseId: string; program?: string; goal?: string } {
  const q = new URLSearchParams(window.location.search);
  return {
    caseId: (q.get('case') || '').trim(),
    program: (q.get('program') || '').trim() || undefined,
    goal: (q.get('goal') || '').trim() || undefined,
  };
}

function isLegacyAthenaId(id: string): boolean {
  return /^ATHENA-/i.test(id);
}

function normalizeUuid(id: string): string | null {
  const hex = id.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

function MetaProgress(props: {
  targetUsd: number;
  raisedSol: number;
  solUsd: number | null;
  compact?: boolean;
  /** ISO 4217 del plan (PEN, USD, …) para la meta mostrada. */
  planCurrency?: string;
}) {
  const { targetUsd, raisedSol, solUsd, compact, planCurrency } = props;
  const raisedUsd = solUsd != null ? raisedSol * solUsd : null;
  const pct =
    targetUsd > 0 && raisedUsd != null
      ? Math.min(100, Math.max(0, (raisedUsd / targetUsd) * 100))
      : null;
  const met = pct != null && pct >= 99.5;

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {met && (
        <p className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
          <Target className="w-3 h-3" /> Meta alcanzada (aprox.)
        </p>
      )}
      <div className="flex justify-between text-[10px] text-gray-500">
        <span>
          Recaudado:{' '}
          <span className="text-solana-mint font-mono">{raisedSol.toFixed(4)} SOL</span>
          {raisedUsd != null && (
            <span className="text-gray-400"> (~${raisedUsd.toFixed(0)} USD)</span>
          )}
        </span>
        <span>
          Meta:{' '}
          <span className="text-white font-mono">{formatPlanMoney(targetUsd, planCurrency)}</span>
        </span>
      </div>
      <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${met ? 'bg-emerald-500' : 'bg-solana-bar bg-[length:200%_100%]'}`}
          style={{ width: `${pct ?? 0}%` }}
        />
      </div>
      {pct != null && solUsd != null && (
        <p className="text-[9px] text-gray-600">
          {pct.toFixed(0)}% de la meta · precio SOL referencial (CoinGecko)
        </p>
      )}
      {solUsd == null && (
        <p className="text-[9px] text-amber-500/80">Sin precio SOL: barra por SOL solamente.</p>
      )}
    </div>
  );
}

type MarketRow = CaseListing & {
  raisedSol: number;
  exists: boolean;
  /** Estado decodificado vía Anchor (`case.fetch`), o null si solo hay lamports / sin cuenta */
  chain: PoolCaseInfo | null;
};

export const DonatePage: React.FC = () => {
  const pool = useMemo(() => getSolanaPoolClient(), []);
  const explorer = useMemo(() => getExplorer(), []);
  const initial = useMemo(() => readParams(), []);
  const envProgram = String(import.meta.env.VITE_SOLANA_PROGRAM_ID ?? '').trim();

  const [tab, setTab] = useState<'explore' | 'direct'>(() =>
    initial.caseId && !isLegacyAthenaId(initial.caseId) ? 'direct' : 'explore',
  );

  const [caseInput, setCaseInput] = useState(() => {
    if (initial.caseId && !isLegacyAthenaId(initial.caseId)) {
      const n = normalizeUuid(initial.caseId);
      return n || initial.caseId;
    }
    return initial.caseId;
  });
  const [programInput, setProgramInput] = useState(
    () => initial.program?.trim() || envProgram,
  );
  const [goalHint] = useState(initial.goal);

  const [solUsd, setSolUsd] = useState<number | null>(null);
  const [listings, setListings] = useState<CaseListing[]>([]);
  const [marketRows, setMarketRows] = useState<MarketRow[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listingLoadError, setListingLoadError] = useState<string | null>(null);
  const [chainHydrating, setChainHydrating] = useState(false);

  const [detailListing, setDetailListing] = useState<CaseListing | null>(null);

  const [donorPk, setDonorPk] = useState<PublicKey | null>(null);
  const [amount, setAmount] = useState('0.05');
  const [casePda, setCasePda] = useState<string>('');
  const [balanceSol, setBalanceSol] = useState<number | null>(null);
  const [accountExists, setAccountExists] = useState<boolean | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const programIdStr = programInput?.trim() || envProgram;

  const targetUsdMeta = useMemo(() => {
    const fromListing = detailListing?.targetUsd;
    if (typeof fromListing === 'number' && fromListing > 0) return fromListing;
    const g = goalHint ? parseFloat(goalHint) : NaN;
    if (Number.isFinite(g) && g > 0) return g;
    return 0;
  }, [detailListing, goalHint]);

  useEffect(() => {
    void fetchSolUsd().then(setSolUsd);
  }, []);

  const mergePublicListingsWithMyPlan = useCallback(async (publicRows: CaseListing[]) => {
    const merged = [...publicRows];
    const user = auth.currentUser;
    if (!user) return merged;
    try {
      const plan = await loadEscapePlan(user.uid);
      const mine = escapePlanToCaseListing(plan);
      if (!mine) return merged;
      const id = normalizeUuid(mine.caseId);
      if (!id) return merged;

      const pseudo =
        typeof plan?.beneficiaryPseudonym === 'string' ? plan.beneficiaryPseudonym.trim() : '';
      const narrative =
        typeof plan?.donorPublicNarrative === 'string' ? plan.donorPublicNarrative.trim() : '';

      const enrich = (row: CaseListing): CaseListing => ({
        ...row,
        ...(pseudo ? { beneficiaryPseudonym: row.beneficiaryPseudonym || pseudo } : {}),
        ...(narrative ? { donorPublicNarrative: row.donorPublicNarrative || narrative } : {}),
      });

      const idx = merged.findIndex((r) => normalizeUuid(r.caseId) === id);
      if (idx >= 0) {
        merged[idx] = enrich(merged[idx]);
      } else {
        merged.unshift(enrich(mine));
      }
    } catch {
      /* plan no disponible */
    }
    return merged;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setListLoading(true);
      setListingLoadError(null);
      try {
        const rows = await listActiveCaseListings(36);
        const merged = await mergePublicListingsWithMyPlan(rows);
        if (!cancelled) setListings(merged);
      } catch (e) {
        if (!cancelled) {
          setListingLoadError(e instanceof Error ? e.message : 'No se pudieron cargar los casos');
          setListings([]);
        }
      } finally {
        if (!cancelled) setListLoading(false);
      }
    };
    void run();
    const unsub = onAuthStateChanged(auth, () => {
      void run();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [mergePublicListingsWithMyPlan]);

  useEffect(() => {
    let cancelled = false;
    if (listings.length === 0) {
      setMarketRows([]);
      setChainHydrating(false);
      return () => {
        cancelled = true;
      };
    }
    setChainHydrating(true);
    (async () => {
      try {
        const built = await Promise.all(
          listings.map(async (L): Promise<MarketRow | null> => {
            const uuid = normalizeUuid(L.caseId);
            if (!uuid) return null;

            let pid: PublicKey;
            try {
              pid = new PublicKey(L.programId);
            } catch {
              return { ...L, raisedSol: 0, exists: false, chain: null };
            }

            try {
              const chain = await pool.getCaseInfoForProgram(uuid, pid);
              if (chain) {
                return {
                  ...L,
                  raisedSol: chain.balance,
                  exists: true,
                  chain,
                };
              }

              const [pda] = AthenaSolanaPoolClient.casePdaForProgram(uuid, pid);
              const info = await pool.connection.getAccountInfo(pda);
              const lamports = await pool.connection.getBalance(pda);
              const rentMin = await pool.connection.getMinimumBalanceForRentExemption(
                Math.max(80, info?.data.length ?? 200),
              );
              const raised = Math.max(0, lamports - rentMin) / LAMPORTS_PER_SOL;
              return {
                ...L,
                raisedSol: raised,
                exists: !!(info && info.data.length > 0),
                chain: null,
              };
            } catch {
              return { ...L, raisedSol: 0, exists: false, chain: null };
            }
          }),
        );
        const out = built.filter((r): r is MarketRow => r != null);
        if (!cancelled) setMarketRows(out);
      } finally {
        if (!cancelled) setChainHydrating(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listings, pool]);

  const refreshCaseInfo = useCallback(async () => {
    setErr(null);
    setLoadingInfo(true);
    setDetailListing(null);
    try {
      if (!programIdStr) {
        setAccountExists(null);
        setBalanceSol(null);
        setCasePda('');
        setErr('Falta Program ID (?program= o VITE_SOLANA_PROGRAM_ID).');
        return;
      }
      if (isLegacyAthenaId(caseInput)) {
        setAccountExists(false);
        setBalanceSol(null);
        setCasePda('');
        setErr(
          'Este Case ID es el formato antiguo (ATHENA-…). Genera un plan nuevo en la app para obtener un UUID compatible con el contrato.',
        );
        return;
      }
      const uuid = normalizeUuid(caseInput);
      if (!uuid) {
        setAccountExists(null);
        setBalanceSol(null);
        setCasePda('');
        setErr('El Case ID debe ser un UUID (32 caracteres hexadecimales, con o sin guiones).');
        return;
      }

      let listing = await getCaseListing(uuid);
      const sessionUser = auth.currentUser;
      if (sessionUser && listing) {
        try {
          const plan = await loadEscapePlan(sessionUser.uid);
          const planCase = normalizeUuid(String(plan?.caseId || ''));
          if (plan && planCase === uuid) {
            const p = plan as {
              beneficiaryPseudonym?: string;
              donorPublicNarrative?: string;
            };
            const pseudo = p.beneficiaryPseudonym?.trim();
            const narrative = p.donorPublicNarrative?.trim();
            listing = {
              ...listing,
              ...(pseudo ? { beneficiaryPseudonym: listing.beneficiaryPseudonym || pseudo } : {}),
              ...(narrative ? { donorPublicNarrative: listing.donorPublicNarrative || narrative } : {}),
            };
          }
        } catch {
          /* */
        }
      }
      setDetailListing(listing);

      const pid = new PublicKey(programIdStr);
      const [pda] = AthenaSolanaPoolClient.casePdaForProgram(uuid, pid);
      setCasePda(pda.toBase58());

      const info = await pool.connection.getAccountInfo(pda);
      const exists = info != null && info.data.length > 0;
      setAccountExists(exists);

      const lamports = await pool.connection.getBalance(pda);
      const rentMin = await pool.connection.getMinimumBalanceForRentExemption(
        Math.max(80, info?.data.length ?? 200),
      );
      setBalanceSol(Math.max(0, lamports - rentMin) / LAMPORTS_PER_SOL);

      if (!exists) {
        setErr(
          'Este caso no está registrado en cadena todavía. El beneficiario debe completar el plan en Athena (initialize_case vía admin).',
        );
      }
    } catch (e: unknown) {
      console.error(e);
      setErr(e instanceof Error ? e.message : 'No se pudo leer el caso');
      setAccountExists(null);
      setBalanceSol(null);
    } finally {
      setLoadingInfo(false);
    }
  }, [caseInput, pool.connection, programIdStr]);

  useEffect(() => {
    void refreshCaseInfo();
  }, [refreshCaseInfo]);

  const suggestedSol = useMemo(() => {
    if (
      balanceSol == null ||
      solUsd == null ||
      targetUsdMeta <= 0
    )
      return '';
    const raisedUsd = balanceSol * solUsd;
    const remUsd = Math.max(0, targetUsdMeta - raisedUsd);
    if (remUsd <= 0) return '';
    const s = remUsd / solUsd;
    return s.toFixed(4);
  }, [balanceSol, solUsd, targetUsdMeta]);

  const connect = async () => {
    setErr(null);
    const ph = getPhantom();
    if (!ph) {
      setErr('Instala Phantom u otra wallet compatible (window.solana).');
      return;
    }
    try {
      const { publicKey } = await ph.connect();
      setDonorPk(publicKey);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Conexión cancelada');
    }
  };

  const donate = async () => {
    setErr(null);
    setLastSig(null);
    const ph = getPhantom();
    if (!ph || !donorPk) {
      await connect();
      return;
    }
    if (!accountExists) {
      setErr('No se puede donar: el caso no existe en el programa.');
      return;
    }
    const uuid = normalizeUuid(caseInput);
    if (!uuid) {
      setErr('Case ID inválido.');
      return;
    }
    const n = parseFloat(amount.replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) {
      setErr('Indica una cantidad válida de SOL.');
      return;
    }

    setBusy(true);
    try {
      const tx = await pool.buildDonateTransaction(uuid, donorPk, n, programIdStr);
      const { blockhash, lastValidBlockHeight } = await pool.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = donorPk;

      const signed = await ph.signTransaction(tx);
      const raw = signed.serialize();
      const sig = await pool.connection.sendRawTransaction(raw, {
        skipPreflight: false,
        maxRetries: 3,
      });
      await pool.connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      setLastSig(sig);
      await refreshCaseInfo();
      const rows = await listActiveCaseListings(36);
      setListings(await mergePublicListingsWithMyPlan(rows));
    } catch (e: unknown) {
      console.error(e);
      setErr(e instanceof Error ? e.message : 'Transacción rechazada o fallida');
    } finally {
      setBusy(false);
    }
  };

  const legacy = isLegacyAthenaId(caseInput);

  const openMarketCase = (row: MarketRow) => {
    const u = normalizeUuid(row.caseId);
    if (u) {
      setCaseInput(u);
      setProgramInput(row.programId);
      setTab('direct');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-full w-full bg-neutral-950 text-white flex flex-col items-center px-4 py-6 overflow-y-auto">
      <div className="w-full max-w-lg">
        <div className="flex items-center gap-2 mb-3">
          <img src="/solana-mark.png" alt="" className="w-10 h-10 rounded-lg object-contain" />
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-solana-mint to-solana-violet bg-clip-text text-transparent">
              Athena · Donaciones
            </h1>
            <p className="text-[10px] text-gray-500 font-mono">Solana Devnet · Pool + marketplace</p>
          </div>
        </div>

        <div className="flex rounded-xl bg-black border border-neutral-800 p-1 mb-6">
          <button
            type="button"
            onClick={() => setTab('explore')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1 transition ${tab === 'explore' ? 'bg-solana-violet/30 text-solana-mint' : 'text-gray-500'}`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Explorar casos
          </button>
          <button
            type="button"
            onClick={() => setTab('direct')}
            className={`flex-1 py-2 text-xs font-bold rounded-lg flex items-center justify-center gap-1 transition ${tab === 'direct' ? 'bg-solana-violet/30 text-solana-mint' : 'text-gray-500'}`}
          >
            <Target className="w-3.5 h-3.5" />
            Donar con Case ID
          </button>
        </div>

        {tab === 'explore' && (
          <section className="mb-8">
            <p className="text-xs text-gray-400 mb-3">
              Los casos y metas vienen de <strong>Firestore</strong>; el saldo y las estadísticas del contrato
              AthenaPool se leen en vivo con <strong>@solana/web3.js</strong> y <strong>Anchor</strong>{' '}
              usando el <code className="text-gray-500">programId</code> de cada fila.
            </p>
            {listLoading && (
              <p className="text-xs text-gray-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando Firestore…
              </p>
            )}
            {chainHydrating && !listLoading && listings.length > 0 && (
              <p className="text-xs text-solana-mint/90 flex items-center gap-2 mb-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Sincronizando cuentas en Solana…
              </p>
            )}
            {listingLoadError && (
              <p className="text-xs text-amber-400 mb-2">
                {listingLoadError}
                <span className="block text-[10px] text-gray-500 mt-1">
                  Si ves <code className="text-gray-400">permission-denied</code>, aplica el fragmento de{' '}
                  <code className="text-gray-400">case_listings.firestore.rules</code>. Si falla solo el índice,
                  crea el índice para <code className="text-gray-400">case_listings · updatedAt</code>.
                </span>
              </p>
            )}
            {!listLoading && !listingLoadError && marketRows.length === 0 && (
              <div className="text-xs text-gray-500 space-y-2 rounded-xl border border-neutral-800 bg-neutral-900/30 p-3 mb-3">
                <p className="font-semibold text-gray-400">No hay casos en el marketplace</p>
                <ul className="list-disc pl-4 space-y-1.5 text-[11px] leading-relaxed text-gray-500">
                  <li>
                    <strong className="text-gray-400">Colección vacía o sin permiso de lectura:</strong> en Consola
                    Firebase → Reglas, permite <code className="text-gray-400">read</code> en{' '}
                    <code className="text-gray-400">case_listings</code> (ver{' '}
                    <code className="text-gray-400">case_listings.firestore.rules</code> en el proyecto).
                  </li>
                  <li>
                    Si ya tienes plan en Athena, <strong className="text-gray-400">inicia sesión</strong> en esta
                    misma app: tu UUID puede mostrarse como «Tu plan» aunque no exista aún documento público.
                  </li>
                  <li>
                    Los casos se publican al guardar un plan con <code className="text-gray-400">saveCaseListing</code>{' '}
                    (programa + UUID). También puedes usar la pestaña «Donar con Case ID» con un enlace directo.
                  </li>
                </ul>
              </div>
            )}
            <div className="space-y-3">
              {marketRows.map((row) => (
                <div
                  key={`${row.caseId}-${row.origin ?? 'pub'}`}
                  className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-3 space-y-2"
                >
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] text-gray-500 uppercase tracking-wider">Case ID</p>
                      <code className="text-[11px] text-solana-mint break-all">{row.caseId}</code>
                      <p className="text-[9px] text-gray-600 font-mono mt-1 break-all">
                        Programa: {row.programId.slice(0, 8)}…{row.programId.slice(-6)}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {row.origin === 'my_plan' && (
                        <span className="text-[9px] px-2 py-0.5 rounded bg-violet-500/25 text-violet-200">
                          Tu plan
                        </span>
                      )}
                      {!row.exists && (
                        <span className="text-[9px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-400">
                          Sin cuenta on-chain
                        </span>
                      )}
                    </div>
                  </div>
                  {row.chainRegistered === false && (
                    <p className="text-[9px] text-sky-300/90 leading-snug">
                      Visible en Firestore; hace falta{' '}
                      <strong className="text-sky-200">initialize_case</strong> en el programa para donar al PDA.
                    </p>
                  )}
                  {row.chain && (
                    <div className="rounded-lg border border-solana-violet/20 bg-solana-violet/5 px-2 py-1.5 space-y-1">
                      <p className="text-[10px] text-gray-300">
                        <span className="text-solana-mint font-semibold">Contrato on-chain</span> ·{' '}
                        {row.chain.donorCount} aportes · {row.chain.totalDonations.toFixed(4)} SOL acumulados
                        (ledger) · saldo PDA {row.chain.balance.toFixed(4)} SOL
                      </p>
                      <p className="text-[9px] text-gray-500">
                        Estado caso:{' '}
                        {row.chain.isActive ? (
                          <span className="text-emerald-400">activo</span>
                        ) : (
                          <span className="text-amber-400">inactivo</span>
                        )}
                        {' · '}
                        <a
                          href={row.chain.donationUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-solana-mint underline"
                        >
                          Ver PDA en explorer
                        </a>
                      </p>
                    </div>
                  )}
                  {!row.chain && row.exists && (
                    <p className="text-[10px] text-amber-500/90">
                      Cuenta PDA presente pero no se pudo decodificar el layout Anchor (IDL / programa distinto).
                    </p>
                  )}
                  {row.destination && (
                    <p className="text-xs text-gray-300 line-clamp-2">
                      <span className="text-gray-500">Destino: </span>
                      {row.destination}
                    </p>
                  )}
                  {(row.beneficiaryPseudonym || row.donorPublicNarrative) && (
                    <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.07] px-2.5 py-2 space-y-1.5">
                      <p className="text-[10px] font-bold text-rose-300 uppercase tracking-wide">
                        Historia para donantes
                      </p>
                      {row.beneficiaryPseudonym && (
                        <p className="text-[12px] text-white font-semibold">{row.beneficiaryPseudonym}</p>
                      )}
                      {row.donorPublicNarrative && (
                        <p className="text-[11px] text-gray-200 leading-relaxed whitespace-pre-wrap">
                          {row.donorPublicNarrative}
                        </p>
                      )}
                      <p className="text-[9px] text-gray-500 leading-snug">
                        Texto orientado a proteger identidades; verifica siempre el explorer y no sustituye ayuda
                        profesional.
                      </p>
                    </div>
                  )}
                  {(row.trustBlurb ||
                    (typeof row.evidenceTotalCount === 'number' && row.evidenceTotalCount > 0) ||
                    typeof row.riskLevel === 'number') && (
                    <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.07] px-2.5 py-2 space-y-1.5">
                      <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wide">
                        Por qué confiar para donar
                      </p>
                      {row.trustBlurb && (
                        <p className="text-[11px] text-gray-200 leading-snug">{row.trustBlurb}</p>
                      )}
                      <ul className="text-[10px] text-gray-400 space-y-0.5 list-disc pl-4 leading-relaxed">
                        {typeof row.riskLevel === 'number' && (
                          <li>
                            Contexto de riesgo en el plan Athena: <strong>{row.riskLevel}/10</strong>
                          </li>
                        )}
                        {typeof row.evidenceTotalCount === 'number' && row.evidenceTotalCount > 0 ? (
                          <li>
                            <strong>{row.evidenceTotalCount}</strong> pieza(s) documentadas en el Evidence Locker
                            {typeof row.evidenceVideoCount === 'number' && row.evidenceVideoCount > 0 ? (
                              <>
                                , incl. <strong>{row.evidenceVideoCount}</strong> video(s)
                              </>
                            ) : null}
                            .
                          </li>
                        ) : (
                          <li className="list-none -ml-4 text-gray-500 italic">
                            Aún sin piezas de evidencia públicas en el índice (puede haber material privado).
                          </li>
                        )}
                        {typeof row.evidenceAnchoredCount === 'number' && row.evidenceAnchoredCount > 0 && (
                          <li>
                            <strong>{row.evidenceAnchoredCount}</strong> registro(s) con ancla IPFS / sellado en cadena.
                          </li>
                        )}
                        {row.chainRegistered === true && (
                          <li>Caso vinculado al programa de donaciones en Solana (cuenta PDA del caso).</li>
                        )}
                      </ul>
                      <p className="text-[9px] text-gray-600 leading-snug">
                        Athena no certifica identidad legal ni dicta sentencias: combina plan, evidencia y contrato para
                        transparencia. Revisa siempre el explorer antes de donar.
                      </p>
                    </div>
                  )}
                  {row.targetUsd > 0 && (
                    <MetaProgress
                      compact
                      targetUsd={row.targetUsd}
                      raisedSol={row.raisedSol}
                      solUsd={solUsd}
                      planCurrency={row.currency}
                    />
                  )}
                  {row.targetUsd <= 0 && (
                    <p className="text-[10px] text-gray-500">
                      Recaudado: {row.raisedSol.toFixed(4)} SOL
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => openMarketCase(row)}
                      className="flex-1 min-w-[120px] py-2 rounded-lg bg-solana-gradient text-black text-xs font-bold"
                    >
                      Donar
                    </button>
                    <a
                      href={explorer.addressUrl(
                        AthenaSolanaPoolClient.casePdaForProgram(
                          normalizeUuid(row.caseId) || row.caseId,
                          new PublicKey(row.programId),
                        )[0].toBase58(),
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-2 rounded-lg border border-neutral-700 text-[10px] text-gray-400 flex items-center gap-1"
                    >
                      PDA <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {tab === 'direct' && (
          <>
            <p className="text-xs text-gray-400 mb-4 leading-relaxed">
              Instrucción <span className="text-solana-mint">donate</span> del programa AthenaPool: transfiere SOL al
              PDA del caso. Necesitas SOL en <strong>Devnet</strong>.
            </p>

            {targetUsdMeta > 0 && balanceSol != null && (
              <div className="mb-4 p-3 rounded-xl bg-solana-violet/10 border border-solana-violet/25">
                <p className="text-[10px] text-solana-violet font-bold mb-2 uppercase tracking-wider">
                  Progreso hacia la meta
                </p>
                <MetaProgress
                  targetUsd={targetUsdMeta}
                  raisedSol={balanceSol}
                  solUsd={solUsd}
                  planCurrency={detailListing?.currency}
                />
                {suggestedSol && accountExists && (
                  <button
                    type="button"
                    className="mt-2 text-[10px] text-solana-mint underline"
                    onClick={() => setAmount(suggestedSol)}
                  >
                    Usar cantidad sugerida para acercarse a la meta: {suggestedSol} SOL
                  </button>
                )}
              </div>
            )}

                {detailListing && (
              <div className="mb-4 text-[11px] bg-black/50 border border-neutral-800 rounded-xl p-3 space-y-1">
                <p>
                  <span className="text-gray-500">Destino: </span>
                  {detailListing.destination || '—'}
                </p>
                {detailListing.riskLevel != null && (
                  <p>
                    <span className="text-gray-500">Nivel de riesgo (plan): </span>
                    {detailListing.riskLevel}
                  </p>
                )}
                {(detailListing.beneficiaryPseudonym || detailListing.donorPublicNarrative) && (
                  <div className="pt-2 mt-2 border-t border-neutral-800 space-y-1">
                    <p className="text-[10px] font-bold text-rose-300 uppercase">Historia para donantes</p>
                    {detailListing.beneficiaryPseudonym && (
                      <p className="text-white font-semibold">{detailListing.beneficiaryPseudonym}</p>
                    )}
                    {detailListing.donorPublicNarrative && (
                      <p className="text-gray-200 whitespace-pre-wrap leading-relaxed">
                        {detailListing.donorPublicNarrative}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Case ID (UUID)
            </label>
            <input
              value={caseInput}
              onChange={(e) => setCaseInput(e.target.value.trim())}
              onBlur={() => void refreshCaseInfo()}
              placeholder="ej. a1b2c3d4-..."
              className="w-full bg-black border border-neutral-700 rounded-xl px-3 py-2 text-sm font-mono text-solana-mint focus:border-solana-mint outline-none mb-2"
            />

            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Program ID
            </label>
            <input
              value={programInput}
              onChange={(e) => setProgramInput(e.target.value.trim())}
              onBlur={() => void refreshCaseInfo()}
              placeholder="GHhuw..."
              className="w-full bg-black border border-neutral-700 rounded-xl px-3 py-2 text-xs font-mono text-gray-300 focus:border-solana-mint outline-none mb-3"
            />

            {casePda && !legacy && (
              <div className="mb-4 p-3 rounded-xl bg-black/50 border border-neutral-800">
                <p className="text-[10px] text-gray-500 mb-1">PDA del caso</p>
                <div className="flex items-start justify-between gap-2">
                  <code className="text-[11px] text-gray-300 break-all">{casePda}</code>
                  <a
                    href={explorer.addressUrl(casePda)}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-solana-mint"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </a>
                </div>
                {loadingInfo ? (
                  <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Leyendo cadena…
                  </p>
                ) : balanceSol != null ? (
                  <p className="text-xs mt-2 text-gray-400">
                    Saldo donable (aprox.):{' '}
                    <span className="text-white font-mono">{balanceSol.toFixed(4)} SOL</span>
                  </p>
                ) : null}
              </div>
            )}

            {err && (
              <div className="mb-4 text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
                {err}
              </div>
            )}

            {lastSig && (
              <div className="mb-4 text-xs text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                <p className="font-semibold mb-1">Donación enviada</p>
                <a
                  href={explorer.txUrl(lastSig)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-solana-mint underline break-all font-mono"
                >
                  {lastSig}
                </a>
              </div>
            )}

            <div className="space-y-3 mb-6">
              <button
                type="button"
                onClick={() => void connect()}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border border-solana-violet/40 bg-solana-violet/10 text-solana-mint font-bold text-sm"
              >
                <Wallet className="w-4 h-4" />
                {donorPk
                  ? `Conectado: ${donorPk.toBase58().slice(0, 4)}…${donorPk.toBase58().slice(-4)}`
                  : 'Conectar wallet'}
              </button>

              <div>
                <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                  Cantidad (SOL)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-black border border-neutral-700 rounded-xl px-3 py-2 text-sm font-mono text-white focus:border-solana-mint outline-none"
                />
              </div>

              <button
                type="button"
                disabled={busy || !accountExists || legacy || !programIdStr}
                onClick={() => void donate()}
                className="w-full py-3 rounded-xl font-bold text-sm bg-solana-gradient text-black disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-solana-violet/20"
              >
                {busy ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Firmando…
                  </span>
                ) : (
                  'Enviar donación (donate)'
                )}
              </button>
            </div>
          </>
        )}

        <button
          type="button"
          className="w-full py-2 text-xs text-gray-500 hover:text-gray-300"
          onClick={() => {
            const rawBase = import.meta.env.BASE_URL ?? '/';
            const base = rawBase === '/' ? '' : rawBase.replace(/\/$/, '');
            window.location.href = `${window.location.origin}${base}/`;
          }}
        >
          ← Volver a la app
        </button>
      </div>
    </div>
  );
};

export default DonatePage;
