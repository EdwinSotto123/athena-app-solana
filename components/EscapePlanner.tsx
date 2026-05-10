import React, { useState, useEffect, useRef, useCallback } from 'react';
import { sendPlannerMessage } from '../services/geminiService';
import type { PlannerClientHints } from '../services/aiClient';
import { EscapePlan, ChatMessage } from '../types';
import { Cpu, Cloud, CloudOff, Loader2, Check, Circle, MapPin } from 'lucide-react';
import {
  auth,
  saveChatMessage,
  loadChatHistory,
  saveEscapePlan,
  loadEscapePlan,
  saveSafeContact,
  loadPlannerProfile,
  savePlannerProfile,
  saveCaseListing,
  mergeCaseListingEvidenceStats,
} from '../lib/firebase';
import { formatPlanMoney, planCurrencyPrefix } from '../lib/plan-currency';
import { getSolanaPoolClient } from '../lib/solana-pool-client';
import { PublicKey } from '@solana/web3.js';

const SOLANA_PROGRAM_ID = String(import.meta.env.VITE_SOLANA_PROGRAM_ID ?? '').trim();

function pickSafeContactPubkey(plan: EscapePlan | undefined): string {
  const ec = plan?.emergencyContact as
    | { withdrawalMethod?: string; contactInfo?: string }
    | undefined;
  if (ec?.withdrawalMethod === 'WALLET' && ec.contactInfo?.trim()) {
    try {
      new PublicKey(ec.contactInfo.trim());
      return ec.contactInfo.trim();
    } catch {
      /* not a valid Solana address */
    }
  }
  return '';
}

function resourceContactHref(phoneOrUrl: string): string | null {
  const t = phoneOrUrl.trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^tel:/i.test(t)) return t;
  const compact = t.replace(/[\s-]/g, '');
  if (/^\+?\d{6,}$/.test(compact)) return `tel:${compact}`;
  return null;
}

function stepMapHref(mapQueryOrUrl?: string): string | undefined {
  if (!mapQueryOrUrl?.trim()) return undefined;
  const t = mapQueryOrUrl.trim();
  if (/^https?:\/\//i.test(t)) return t;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(t)}`;
}

function phoneTelHref(phone?: string): string | null {
  if (!phone?.trim()) return null;
  const compact = phone.replace(/[^\d+]/g, '');
  if (/^\+?\d{6,}$/.test(compact)) return `tel:${compact}`;
  return null;
}

const INITIAL_MESSAGE: ChatMessage = {
  role: 'model',
  text:
    "Hola 💜 Soy Athena, tu compañía silenciosa. Valoramos muchísimo que hayas llegado hasta aquí.\n\n" +
    "Esto es una herramienta REAL de protección (no es un engaño). Puedo ayudarte con:\n" +
    "• Bóveda Freedom en la red Solana (ahorro que otros no ven en la app)\n" +
    "• Locker de evidencia con sellos de tiempo\n" +
    "• Un plan de escape con recursos locales (líneas de emergencia, orientación)\n\n" +
    "Arriba puedes indicar país, región y ciudad para recomendaciones más precisas. " +
    "¿Cómo te sientes ahora? ¿Estás en un lugar seguro para conversar?",
};

export const EscapePlanner: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [plan, setPlan] = useState<EscapePlan | null>(null);
  const [isSynced, setIsSynced] = useState(false);
  const [completedPhases, setCompletedPhases] = useState<{ [key: number]: boolean }>({});
  const [plannerCountry, setPlannerCountry] = useState('');
  const [plannerRegion, setPlannerRegion] = useState('');
  const [plannerCity, setPlannerCity] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Checklist local antes de pedir un plan (no sustituye ayuda profesional). */
  const [prepChecks, setPrepChecks] = useState({
    safety: false,
    privacy: false,
    truthful: false,
    contactAware: false,
  });
  const prepComplete = Object.values(prepChecks).every(Boolean);

  const buildClientHints = useCallback((): PlannerClientHints => {
    let timeZone: string | undefined;
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      timeZone = undefined;
    }
    return {
      locale: typeof navigator !== 'undefined' ? navigator.language : undefined,
      timeZone,
      country: plannerCountry.trim() || undefined,
      region: plannerRegion.trim() || undefined,
      city: plannerCity.trim() || undefined,
    };
  }, [plannerCountry, plannerRegion, plannerCity]);

  const persistPlannerProfile = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) return;
    try {
      await savePlannerProfile(user.uid, {
        country: plannerCountry.trim() || undefined,
        region: plannerRegion.trim() || undefined,
        city: plannerCity.trim() || undefined,
      });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (e) {
      console.error('[EscapePlanner] save planner profile', e);
    }
  }, [plannerCountry, plannerRegion, plannerCity]);

  // Load chat history from Firestore on mount
  useEffect(() => {
    const loadHistory = async () => {
      const user = auth.currentUser;

      if (user) {
        setIsLoadingHistory(true);
        try {
          // Load chat history
          const history = await loadChatHistory(user.uid, 100);

          if (history.length > 0) {
            // Map firebase messages to local format
            const loadedMessages: ChatMessage[] = history.map(msg => ({
              role: msg.role,
              text: msg.text
            }));
            setMessages(loadedMessages);
            setIsSynced(true);
          } else {
            // No history - start with initial message and save it
            setMessages([INITIAL_MESSAGE]);
            await saveChatMessage(user.uid, INITIAL_MESSAGE);
            setIsSynced(true);
          }

          const plannerProf = await loadPlannerProfile(user.uid);
          if (plannerProf) {
            setPlannerCountry(plannerProf.country || '');
            setPlannerRegion(plannerProf.region || '');
            setPlannerCity(plannerProf.city || '');
          }

          // Load saved plan if exists
          const savedPlan = await loadEscapePlan(user.uid);
          if (savedPlan?.locationContext) {
            const lc = savedPlan.locationContext;
            setPlannerCountry((c) => c || lc.country || '');
            setPlannerRegion((r) => r || lc.regionOrState || '');
            setPlannerCity((ci) => ci || lc.city || '');
          }
          if (savedPlan && savedPlan.isReady) {
            setPlan(savedPlan);
          }

        } catch (error) {
          console.error('[EscapePlanner] Failed to load history:', error);
          setIsSynced(false);
        } finally {
          setIsLoadingHistory(false);
        }
      } else {
        // No user logged in - use local state only
        setIsLoadingHistory(false);
        setIsSynced(false);
      }
    };

    loadHistory();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    if (!prepComplete) {
      alert(
        'Marca todas las casillas de «Antes de pedir tu plan». Son recordatorios de seguridad y claridad.',
      );
      return;
    }

    const userMsg: ChatMessage = { role: 'user', text: inputText };
    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsTyping(true);

    // Save user message to Firestore
    const user = auth.currentUser;
    if (user) {
      try {
        await saveChatMessage(user.uid, userMsg);
      } catch (error) {
        console.error('[EscapePlanner] Failed to save user message:', error);
      }
    }

    try {
      // Call ADK-TS style agent (via geminiService with context)
      const response = await sendPlannerMessage(
        [...messages, userMsg],
        userMsg.text,
        buildClientHints()
      );

      setIsTyping(false);

      if (response.plan) {
        const pool = getSolanaPoolClient();
        const caseId = pool.generateCaseId();
        const ownerPk = (await pool.resolveAgentPubkey()).trim();
        const safePk = (pickSafeContactPubkey(response.plan) || ownerPk).trim();

        let chainRegistration: NonNullable<EscapePlan['chainRegistration']> | undefined;
        if (SOLANA_PROGRAM_ID && ownerPk && safePk) {
          const cr = await pool.createCase(caseId, ownerPk, safePk);
          chainRegistration = cr.success
            ? { ok: true, txHash: cr.txHash }
            : { ok: false, error: cr.error || 'No se pudo registrar el caso on-chain' };
        } else {
          chainRegistration = {
            ok: false,
            error: !SOLANA_PROGRAM_ID
              ? 'Sin VITE_SOLANA_PROGRAM_ID'
              : 'Sin pubkey del agente (VITE_SOLANA_AGENT_PUBKEY o GET /api/solana/public-key) o contacto seguro',
          };
        }

        // Enhance plan with caseId and Solana program id (donations / on-chain pool)
        const enhancedPlan: EscapePlan = {
          ...response.plan,
          caseId,
          poolContractAddress:
            SOLANA_PROGRAM_ID || response.plan.poolContractAddress || '',
          chainRegistration,
        };

        const lc = enhancedPlan.locationContext;
        if (lc?.country || lc?.regionOrState || lc?.city) {
          const nextCountry = (lc.country || plannerCountry).trim();
          const nextRegion = (lc.regionOrState || plannerRegion).trim();
          const nextCity = (lc.city || plannerCity).trim();
          setPlannerCountry(nextCountry);
          setPlannerRegion(nextRegion);
          setPlannerCity(nextCity);
          if (user) {
            try {
              await savePlannerProfile(user.uid, {
                country: nextCountry || undefined,
                region: nextRegion || undefined,
                city: nextCity || undefined,
              });
            } catch (e) {
              console.warn('[EscapePlanner] Could not sync profile from plan', e);
            }
          }
        }

        // Save plan to Firestore
        if (user) {
          try {
            await saveEscapePlan(user.uid, enhancedPlan);

            if (enhancedPlan.caseId) {
              const programForListing = (
                enhancedPlan.poolContractAddress ||
                SOLANA_PROGRAM_ID ||
                ''
              ).trim();
              if (programForListing) {
                try {
                  const destShort = (enhancedPlan.destination || '').slice(0, 140);
                  await saveCaseListing({
                    caseId: enhancedPlan.caseId,
                    programId: programForListing,
                    targetUsd: enhancedPlan.freedomGoal.targetAmount,
                    currency: enhancedPlan.freedomGoal.currency || 'USD',
                    destination: enhancedPlan.destination || '',
                    riskLevel: enhancedPlan.riskLevel,
                    active: true,
                    chainRegistered: !!chainRegistration?.ok,
                    trustBlurb: `Plan Athena: riesgo documentado ${enhancedPlan.riskLevel}/10. ${destShort ? `Destino previsto: ${destShort}` : 'Destino por concretar en el plan.'}`,
                    ...(enhancedPlan.beneficiaryPseudonym?.trim()
                      ? { beneficiaryPseudonym: enhancedPlan.beneficiaryPseudonym.trim() }
                      : {}),
                    ...(enhancedPlan.donorPublicNarrative?.trim()
                      ? { donorPublicNarrative: enhancedPlan.donorPublicNarrative.trim() }
                      : {}),
                  });
                  await mergeCaseListingEvidenceStats(user.uid, enhancedPlan.caseId);
                } catch (le) {
                  console.warn('[EscapePlanner] Case listing not published:', le);
                }
              } else {
                console.warn(
                  '[EscapePlanner] No se publicó listing: falta VITE_SOLANA_PROGRAM_ID en el build.',
                );
              }
            }

            // Save emergency contact if provided
            if (response.plan.emergencyContact && response.plan.emergencyContact.name) {
              const withdrawalMethod = (response.plan.emergencyContact as any).withdrawalMethod || 'PHONE';
              const contactData: any = {
                name: response.plan.emergencyContact.name,
                relationship: response.plan.emergencyContact.relationship || 'Emergency Contact',
                withdrawalMethod: withdrawalMethod,
                contactInfo: response.plan.emergencyContact.contactInfo || ''
              };

              // Only add specific fields if they have values (Firestore doesn't accept undefined)
              if (withdrawalMethod === 'WALLET') {
                contactData.walletAddress = response.plan.emergencyContact.contactInfo || '';
              } else if (withdrawalMethod === 'PHONE') {
                contactData.phoneNumber = response.plan.emergencyContact.contactInfo || '';
              } else if (withdrawalMethod === 'CASH_CODE') {
                contactData.fullName = response.plan.emergencyContact.name;
              }

              await saveSafeContact(user.uid, contactData);
            }
          } catch (error) {
            console.error('[EscapePlanner] Failed to save plan:', error);
          }
        }

        // Trigger "Analysis Mode" effect before showing result
        setIsAnalyzing(true);
        setTimeout(() => {
          setIsAnalyzing(false);
          setPlan(enhancedPlan);
        }, 2500); // 2.5s delay for "Wow" factor
      } else {
        const modelMsg: ChatMessage = { role: 'model', text: response.text };
        setMessages(prev => [...prev, modelMsg]);

        // Save model response to Firestore
        if (user) {
          try {
            await saveChatMessage(user.uid, modelMsg);
          } catch (error) {
            console.error('[EscapePlanner] Failed to save model message:', error);
          }
        }
      }
    } catch (error) {
      setIsTyping(false);
      console.error('[EscapePlanner] send failed', error);
      const errorMsg: ChatMessage = {
        role: 'model',
        text:
          'No pudimos conectar con el servidor de Athena (Cloud Function / IA). ' +
          'Revisa tu conexión y que VITE_AI_ENDPOINT_URL esté configurado. Vuelve a intentar en unos segundos.',
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  };

  // 1. LOADING HISTORY SCREEN
  if (isLoadingHistory) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-neutral-950 p-6">
        <Loader2 className="w-10 h-10 text-solana-mint animate-spin mb-4" />
        <p className="text-gray-400 text-sm">Cargando historial y perfil…</p>
      </div>
    );
  }

  // 2. ANALYSIS LOADING SCREEN (The "Wow" Moment)
  if (isAnalyzing) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-black p-6 space-y-6 animate-in fade-in duration-700">
        <div className="relative">
          <div className="w-24 h-24 rounded-full border-4 border-solana-violet/40 border-t-solana-mint animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
            <img src="/solana-mark.png" alt="" className="w-10 h-10 opacity-90 rounded-md object-contain" />
          </div>
        </div>
        <div className="text-center space-y-2">
          <h2 className="text-xl font-mono font-bold tracking-widest animate-pulse bg-gradient-to-r from-solana-mint to-solana-violet bg-clip-text text-transparent">
            ATHENA · SOLANA
          </h2>
          <div className="text-xs text-gray-500 font-mono space-y-1">
            <p>Razonando rutas y contexto local…</p>
            <p>Validando recursos y autoridades…</p>
            <p>Sincronizando con tu perfil…</p>
          </div>
        </div>
      </div>
    );
  }

  // 3. RESULT CARD (The "Checklist" View)
  if (plan) {
    return (
      <div className="p-6 h-full overflow-y-auto bg-neutral-950 animate-in slide-in-from-bottom-10 duration-700">
        {/* Header Card */}
        <div className="flex justify-between items-end mb-6 border-b border-solana-violet/25 pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1 bg-gradient-to-r from-solana-mint to-solana-violet bg-clip-text text-transparent">
              Plan seguro · Solana
            </p>
            <h2 className="text-2xl font-bold text-white leading-none">Operation<br />Freedom</h2>
          </div>
          <div className="text-right">
            <span className={`inline-block px-3 py-1 rounded text-xs font-bold border ${plan.riskLevel >= 8 ? 'bg-red-900/30 border-red-500 text-red-500' : 'bg-yellow-900/30 border-yellow-500 text-yellow-500'}`}>
              RISK LEVEL {plan.riskLevel}
            </span>
          </div>
        </div>

        {/* Financial Goal Dial */}
        <div className="bg-neutral-900/50 rounded-2xl p-6 border border-neutral-800 mb-4 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <svg className="w-24 h-24 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1.41 16.09V20h-2.67v-1.93c-1.71-.36-3.15-1.46-3.27-3.4h1.96c.1 1.05 1.18 1.91 2.53 1.91 1.29 0 2.13-.81 2.13-1.88 0-1.09-.86-1.63-2.6-2.09-2.08-.56-4.18-1.42-4.18-3.92 0-2.06 1.47-3.53 3.43-3.9V3h2.67v1.93c1.38.35 2.58 1.34 2.74 2.95h-2c-.09-.92-1.01-1.45-2.26-1.45-1.2 0-2 .76-2 1.68 0 .96.93 1.48 2.56 1.93 2.19.63 4.22 1.6 4.22 4.1 0 2.05-1.4 3.55-3.36 3.95z" /></svg>
          </div>

          <h3 className="text-gray-400 text-xs uppercase tracking-wider mb-2">Freedom Fund Goal</h3>
          <div className="flex items-end gap-2 mb-4 flex-wrap">
            <span className="text-5xl font-mono font-bold text-white tracking-tighter">
              {formatPlanMoney(plan.freedomGoal.targetAmount, plan.freedomGoal.currency)}
            </span>
            {plan.freedomGoal.currency && (
              <span className="text-gray-500 text-sm mb-2">{plan.freedomGoal.currency}</span>
            )}
          </div>

          <div className="w-full bg-black h-2 rounded-full overflow-hidden">
            <div className="h-full w-[5%] bg-solana-bar bg-[length:200%_100%] animate-pulse shadow-[0_0_12px_rgba(20,241,149,0.45)]" />
          </div>
          <p className="text-[10px] text-gray-500 mt-2 flex justify-between gap-2 flex-wrap">
            <span>
              Current: {formatPlanMoney(plan.freedomGoal.currentAmount, plan.freedomGoal.currency)}
            </span>
            <span>Target for {plan.destination}</span>
          </p>

          {/* Budget Breakdown */}
          {plan.freedomGoal.breakdown && (
            <div className="mt-4 pt-4 border-t border-neutral-800">
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Budget Breakdown</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="flex justify-between text-gray-400">
                  <span>🚗 Transport</span>
                  <span className="text-white">
                    {formatPlanMoney(plan.freedomGoal.breakdown.transport, plan.freedomGoal.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>📦 Supplies</span>
                  <span className="text-white">
                    {formatPlanMoney(plan.freedomGoal.breakdown.supplies, plan.freedomGoal.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>🏠 Shelter</span>
                  <span className="text-white">
                    {formatPlanMoney(plan.freedomGoal.breakdown.shelter, plan.freedomGoal.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-gray-400">
                  <span>⚖️ Legal</span>
                  <span className="text-white">
                    {formatPlanMoney(plan.freedomGoal.breakdown.legal, plan.freedomGoal.currency)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Contexto geográfico (AI + perfil) */}
        {(plan.locationContext &&
          (plan.locationContext.country ||
            plan.locationContext.regionOrState ||
            plan.locationContext.city ||
            plan.locationContext.districtOrNeighborhood)) && (
          <div className="bg-solana-violet/10 border border-solana-violet/30 rounded-xl p-4 mb-4">
            <h4 className="text-solana-mint text-xs font-bold mb-2 flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5" />
              Contexto de ubicación
            </h4>
            <div className="text-xs text-gray-300 space-y-1">
              {plan.locationContext.country && (
                <p>
                  <span className="text-gray-500">País:</span> {plan.locationContext.country}
                </p>
              )}
              {plan.locationContext.regionOrState && (
                <p>
                  <span className="text-gray-500">Región:</span> {plan.locationContext.regionOrState}
                </p>
              )}
              {plan.locationContext.city && (
                <p>
                  <span className="text-gray-500">Ciudad:</span> {plan.locationContext.city}
                </p>
              )}
              {plan.locationContext.districtOrNeighborhood && (
                <p>
                  <span className="text-gray-500">Distrito / zona:</span>{' '}
                  {plan.locationContext.districtOrNeighborhood}
                </p>
              )}
              {plan.locationContext.confidence && (
                <p className="text-[10px] text-gray-500">
                  Confianza: {plan.locationContext.confidence}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Recursos locales recomendados */}
        {plan.localResources && plan.localResources.length > 0 && (
          <div className="bg-neutral-900/60 border border-solana-mint/25 rounded-xl p-4 mb-4">
            <h4 className="text-white text-sm font-bold mb-3 flex items-center gap-2">
              <span className="text-solana-mint">◎</span> Recursos y autoridades locales
            </h4>
            <ul className="space-y-3">
              {plan.localResources.map((res, i) => (
                <li
                  key={`${res.name}-${i}`}
                  className="text-xs border border-neutral-800 rounded-lg p-3 bg-black/30"
                >
                  <div className="flex justify-between gap-2">
                    <span className="text-white font-semibold">{res.name}</span>
                    <span className="text-[10px] uppercase text-solana-violet shrink-0">
                      {res.type.replace('_', ' ')}
                    </span>
                  </div>
                  {(() => {
                    const href = resourceContactHref(res.phoneOrUrl);
                    const isHttp = /^https?:\/\//i.test(href || '');
                    return href ? (
                      <a
                        href={href}
                        {...(isHttp ? { target: '_blank', rel: 'noreferrer' } : {})}
                        className="text-solana-mint/90 font-mono mt-1 break-all underline inline-block"
                      >
                        {res.phoneOrUrl}
                      </a>
                    ) : (
                      <p className="text-solana-mint/90 font-mono mt-1 break-all">{res.phoneOrUrl}</p>
                    );
                  })()}
                  {res.notes && <p className="text-gray-500 mt-1">{res.notes}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {plan.actionableSteps && plan.actionableSteps.length > 0 && (
          <div className="bg-gradient-to-br from-solana-mint/10 to-transparent border border-solana-mint/35 rounded-xl p-4 mb-4">
            <h4 className="text-white text-sm font-bold mb-3 flex items-center gap-2">
              <span className="text-solana-mint">📍</span> Plan detallado (paso a paso)
            </h4>
            <ol className="space-y-4 list-decimal list-inside marker:text-solana-mint">
              {plan.actionableSteps.map((step, i) => {
                const mapUrl = stepMapHref(step.mapQueryOrUrl);
                const tel = phoneTelHref(step.phone);
                return (
                  <li
                    key={`${step.title}-${i}`}
                    className="text-xs border border-neutral-800 rounded-lg p-3 bg-black/40 pl-4"
                  >
                    <span className="font-semibold text-white block mb-1">{step.title}</span>
                    <p className="text-gray-300 leading-relaxed whitespace-pre-wrap">{step.instructions}</p>
                    {step.whatToBring && (
                      <p className="text-[10px] text-amber-200/90 mt-2">
                        <span className="font-bold text-amber-300/90">Qué llevar:</span> {step.whatToBring}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-3 mt-2">
                      {mapUrl && (
                        <a
                          href={mapUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-solana-mint underline font-medium"
                        >
                          Ver en mapa →
                        </a>
                      )}
                      {tel && (
                        <a href={tel} className="text-sky-400 underline font-medium">
                          Llamar
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {/* Emergency Contact Card */}
        {plan.emergencyContact && plan.emergencyContact.name && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-green-500 text-lg">🆘</span>
              <h4 className="text-green-400 text-sm font-bold">Emergency Contact Set</h4>
            </div>
            <div className="text-xs space-y-1">
              <p className="text-gray-300">
                <span className="text-gray-500">Name:</span> {plan.emergencyContact.name}
              </p>
              <p className="text-gray-300">
                <span className="text-gray-500">Contact:</span> {plan.emergencyContact.contactInfo}
              </p>
              <p className="text-gray-300">
                <span className="text-gray-500">Relation:</span> {plan.emergencyContact.relationship}
              </p>
            </div>

            {/* Withdrawal Method Badge */}
            <div className="mt-3 pt-3 border-t border-green-500/20">
              <p className="text-[10px] text-gray-500 mb-1">WITHDRAWAL METHOD</p>
              <div className="flex items-center gap-2">
                {(plan.emergencyContact as any).withdrawalMethod === 'PHONE' ? (
                  <span className="bg-blue-500/20 text-blue-400 px-2 py-1 rounded text-xs">📱 Mobile Money</span>
                ) : (plan.emergencyContact as any).withdrawalMethod === 'CASH_CODE' ? (
                  <span className="bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded text-xs">💵 Cash Pickup (Coming Soon)</span>
                ) : (
                  <span className="bg-purple-500/20 text-purple-400 px-2 py-1 rounded text-xs">🔐 Crypto Wallet</span>
                )}
              </div>
            </div>

            <p className="text-[10px] text-green-600 mt-2">
              SOS (emergencia): en Solana, lo recaudado en tu caso puede enviarse al contacto seguro definido en el plan;
              revisa la pestaña SOS y Ajustes.
            </p>
          </div>
        )}

        {/* The Visual Checklist - INTERACTIVE */}
        <div className="space-y-4">
          <h3 className="text-gray-300 font-bold text-sm flex items-center gap-2">
            <svg className="w-4 h-4 text-solana-mint" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
            Execution Checklist
            <span className="text-[10px] text-gray-500 font-normal ml-auto">
              {Object.values(completedPhases).filter(Boolean).length}/3 complete
            </span>
          </h3>

          {/* Checklist Item 1 - CLICKABLE */}
          <button
            onClick={() => setCompletedPhases(prev => ({ ...prev, 1: !prev[1] }))}
            className={`group relative w-full text-left bg-neutral-900 border rounded-xl p-4 transition active:scale-[0.98] ${completedPhases[1] ? 'border-blue-500/50 bg-blue-500/5' : 'border-neutral-800 hover:border-neutral-700'
              }`}
          >
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl transition ${completedPhases[1] ? 'bg-blue-500' : 'bg-blue-500/30'
              }`}></div>
            <div className="flex gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center mt-0.5 transition ${completedPhases[1]
                ? 'bg-blue-500 text-white'
                : 'border-2 border-neutral-600 group-hover:border-blue-500'
                }`}>
                {completedPhases[1] ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Circle className="w-3 h-3 text-transparent group-hover:text-blue-500" />
                )}
              </div>
              <div>
                <h4 className={`text-sm font-bold transition ${completedPhases[1] ? 'text-blue-400 line-through' : 'text-white'}`}>
                  Phase 1: Immediate Security
                </h4>
                <p className="text-gray-400 text-xs mt-1 leading-relaxed">{plan.strategy.step1}</p>
              </div>
            </div>
          </button>

          {/* Checklist Item 2 - CLICKABLE */}
          <button
            onClick={() => setCompletedPhases(prev => ({ ...prev, 2: !prev[2] }))}
            className={`group relative w-full text-left bg-neutral-900 border rounded-xl p-4 transition active:scale-[0.98] ${completedPhases[2] ? 'border-purple-500/50 bg-purple-500/5' : 'border-neutral-800 hover:border-neutral-700'
              }`}
          >
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl transition ${completedPhases[2] ? 'bg-purple-500' : 'bg-purple-500/30'
              }`}></div>
            <div className="flex gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center mt-0.5 transition ${completedPhases[2]
                ? 'bg-purple-500 text-white'
                : 'border-2 border-neutral-600 group-hover:border-purple-500'
                }`}>
                {completedPhases[2] ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Circle className="w-3 h-3 text-transparent group-hover:text-purple-500" />
                )}
              </div>
              <div>
                <h4 className={`text-sm font-bold transition ${completedPhases[2] ? 'text-purple-400 line-through' : 'text-white'}`}>
                  Phase 2: Logistics & Funding
                </h4>
                <p className="text-gray-400 text-xs mt-1 leading-relaxed">{plan.strategy.step2}</p>
              </div>
            </div>
          </button>

          {/* Checklist Item 3 - CLICKABLE */}
          <button
            onClick={() => setCompletedPhases(prev => ({ ...prev, 3: !prev[3] }))}
            className={`group relative w-full text-left bg-neutral-900 border rounded-xl p-4 transition active:scale-[0.98] ${completedPhases[3] ? 'border-green-500/50 bg-green-500/5' : 'border-neutral-800 hover:border-neutral-700'
              }`}
          >
            <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl transition ${completedPhases[3] ? 'bg-green-500' : 'bg-green-500/30'
              }`}></div>
            <div className="flex gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center mt-0.5 transition ${completedPhases[3]
                ? 'bg-green-500 text-white'
                : 'border-2 border-neutral-600 group-hover:border-green-500'
                }`}>
                {completedPhases[3] ? (
                  <Check className="w-4 h-4" />
                ) : (
                  <Circle className="w-3 h-3 text-transparent group-hover:text-green-500" />
                )}
              </div>
              <div>
                <h4 className={`text-sm font-bold transition ${completedPhases[3] ? 'text-green-400 line-through' : 'text-white'}`}>
                  Phase 3: Extraction
                </h4>
                <p className="text-gray-400 text-xs mt-1 leading-relaxed">{plan.strategy.step3}</p>
              </div>
            </div>
          </button>
        </div>

        {/* Next Steps Guide */}
        {plan.nextSteps && plan.nextSteps.length > 0 && (
          <div className="mt-6 bg-solana-violet/10 border border-solana-mint/30 rounded-xl p-4">
            <h4 className="text-solana-mint text-sm font-bold mb-3 flex items-center gap-2">
              <span>📋</span> Próximos pasos
            </h4>
            <ul className="space-y-2">
              {plan.nextSteps.map((step, index) => (
                <li key={index} className="flex items-start gap-2 text-xs text-gray-300">
                  <span className="text-solana-violet font-bold">{index + 1}.</span>
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Pool Solana / ángeles */}
        <div className="mt-6 bg-gradient-to-br from-solana-violet/25 to-solana-mint/10 border border-solana-mint/30 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <img src="/solana-mark.png" alt="" className="w-8 h-8 rounded-md object-contain opacity-90" />
            <h4 className="text-solana-mint text-sm font-bold">Community Angels · Solana</h4>
          </div>

          <p className="text-gray-400 text-xs mb-4">
            Comparte tu caso para recibir donaciones anónimas. La bóveda Athena está en la red{' '}
            <strong className="text-solana-mint">Solana Devnet</strong> (demo).
          </p>

          {/* Program ID */}
          <div className="bg-black/40 rounded-lg p-3 mb-3">
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Program ID (Athena Pool)</p>
            <div className="flex items-center justify-between gap-2">
              <code className="text-xs text-solana-mint font-mono break-all">
                {plan.poolContractAddress ||
                  SOLANA_PROGRAM_ID ||
                  'Configura VITE_SOLANA_PROGRAM_ID'}
              </code>
              <button
                type="button"
                onClick={() => {
                  const pid =
                    plan.poolContractAddress || SOLANA_PROGRAM_ID || '';
                  if (!pid) {
                    alert('No hay Program ID configurado.');
                    return;
                  }
                  void navigator.clipboard.writeText(pid);
                  alert('Program ID copiado.');
                }}
                className="ml-2 shrink-0 px-2 py-1 bg-solana-violet/30 text-solana-mint text-[10px] rounded hover:bg-solana-violet/40 transition"
              >
                COPIAR
              </button>
            </div>
          </div>

          {plan.chainRegistration && (
            <div
              className={`mb-3 text-[11px] rounded-lg px-3 py-2 border ${
                plan.chainRegistration.ok
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
              }`}
            >
              {plan.chainRegistration.ok ? (
                <p>
                  Caso registrado en el programa Pool.
                  {plan.chainRegistration.txHash &&
                    !plan.chainRegistration.txHash.startsWith('demo_') && (
                      <>
                        {' '}
                        Tx:{' '}
                        <span className="font-mono break-all">{plan.chainRegistration.txHash}</span>
                      </>
                    )}
                  {plan.chainRegistration.txHash &&
                    plan.chainRegistration.txHash.startsWith('demo_') && (
                      <span className="block text-amber-400 mt-1">
                        (Demo: configura la wallet admin para una firma real.)
                      </span>
                    )}
                </p>
              ) : (
                <p>On-chain: {plan.chainRegistration.error}</p>
              )}
            </div>
          )}

          {/* CaseID for donations */}
          {plan.caseId && (
            <div className="bg-black/40 rounded-lg p-3 mb-3">
              <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-1">Case ID (donaciones)</p>
              <div className="flex items-center justify-between">
                <code className="text-xs text-green-400 font-mono">{plan.caseId}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(plan.caseId || '');
                    alert('Case ID copiado.');
                  }}
                  className="ml-2 px-2 py-1 bg-green-500/20 text-green-400 text-[10px] rounded hover:bg-green-500/30 transition"
                >
                  COPIAR
                </button>
              </div>
              <a
                href={getSolanaPoolClient().getShareableLink(
                  plan.caseId,
                  plan.freedomGoal.targetAmount,
                )}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex items-center gap-1 text-solana-mint text-[10px] font-bold hover:underline"
              >
                Abrir página de donación →
              </a>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-500 mb-4">
            <span>
              Red: <span className="text-solana-violet">Solana Devnet</span>
            </span>
            <span>
              Explorador:{' '}
              <a
                className="text-solana-mint underline"
                href="https://explorer.solana.com/?cluster=devnet"
                target="_blank"
                rel="noreferrer"
              >
                Solana Explorer
              </a>
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              const pool = getSolanaPoolClient();
              const pid = plan.poolContractAddress || SOLANA_PROGRAM_ID || '';
              const donateUrl = plan.caseId
                ? pool.getShareableLink(plan.caseId, plan.freedomGoal.targetAmount)
                : '';
              const shareText =
                `🆘 Apoyo vía Athena (Solana Devnet)\n\n` +
                `Program ID: ${pid || '(sin configurar)'}\n` +
                `Case ID: ${plan.caseId || '—'}\n` +
                `Meta: ${formatPlanMoney(plan.freedomGoal.targetAmount, plan.freedomGoal.currency)} (${plan.freedomGoal.currency || 'USD'})\n\n` +
                (donateUrl ? `Donar (web):\n${donateUrl}\n\n` : '') +
                `#Athena #Solana`;

              if (navigator.share) {
                void navigator.share({ title: 'Athena · Solana', text: shareText });
              } else {
                void navigator.clipboard.writeText(shareText);
                alert('Texto copiado al portapapeles.');
              }
            }}
            className="w-full py-3 bg-solana-gradient text-black rounded-xl font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-solana-violet/25"
          >
            <span>📤</span> Compartir caso
          </button>

          <p className="text-[10px] text-gray-600 text-center mt-2">
            MVP en Devnet; verifica siempre en Explorer.
          </p>
        </div>

        {/* Quick Commands Reminder */}
        <div className="mt-4 bg-neutral-900 border border-neutral-800 rounded-xl p-4">
          <p className="text-[10px] text-gray-600 uppercase tracking-wider mb-2">Secret Commands</p>
          <div className="flex gap-4 text-xs">
            <div className="text-gray-400">
              <span className="text-white font-mono">9÷11=</span> Check Balance
            </div>
            <div className="text-gray-400">
              <span className="text-white font-mono">7x7=</span> Pool Status
            </div>
            <div className="text-gray-400">
              <span className="text-white font-mono">0÷0=</span> <span className="text-red-400">SOS</span>
            </div>
          </div>
        </div>

        <button
          onClick={() => setPlan(null)}
          className="w-full mt-6 py-3 text-xs text-gray-500 hover:text-white transition uppercase tracking-widest border border-transparent hover:border-gray-800 rounded-lg"
        >
          Modify Parameters
        </button>
      </div>
    );
  }

  // 4. CHAT INTERFACE
  return (
    <div className="flex flex-col h-full bg-neutral-950">
      <div className="p-4 border-b border-solana-violet/25 bg-neutral-900/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex justify-between items-start gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <img src="/solana-mark.png" alt="" className="w-9 h-9 rounded-md object-contain shrink-0 mt-0.5 hidden sm:block" />
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="w-2 h-2 rounded-full animate-pulse bg-solana-mint shadow-[0_0_8px_#14F195]" />
                Athena Planner
              </h2>
              <p className="text-[10px] text-gray-500 font-mono uppercase tracking-wider">
                Solana · Vertex AI · Firestore
              </p>
            </div>
          </div>

          {/* Sync Status + backend badge */}
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-mono ${
                isSynced ? 'bg-solana-mint/15 text-solana-mint' : 'bg-yellow-500/20 text-yellow-400'
              }`}
            >
              {isSynced ? <Cloud className="w-3 h-3" /> : <CloudOff className="w-3 h-3" />}
              {isSynced ? 'Nube' : 'Local'}
            </div>

            <div className="flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-mono bg-solana-violet/20 text-solana-violet">
              <Cpu className="w-3 h-3" />
              CF
            </div>
          </div>
        </div>

        <div className="mt-3 pt-3 border-t border-neutral-800 space-y-2">
          <p className="text-[10px] text-gray-500 flex items-center gap-1">
            <MapPin className="w-3 h-3 text-solana-mint shrink-0" />
            País / región / ciudad (se envían al planner y se guardan en Firebase)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              value={plannerCountry}
              onChange={(e) => setPlannerCountry(e.target.value)}
              placeholder="País"
              className="w-full bg-black border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-solana-mint outline-none"
            />
            <input
              value={plannerRegion}
              onChange={(e) => setPlannerRegion(e.target.value)}
              placeholder="Región / estado"
              className="w-full bg-black border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-solana-mint outline-none"
            />
            <input
              value={plannerCity}
              onChange={(e) => setPlannerCity(e.target.value)}
              placeholder="Ciudad"
              className="w-full bg-black border border-neutral-700 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-solana-mint outline-none"
            />
          </div>
          <div className="flex justify-end items-center gap-2">
            {profileSaved && (
              <span className="text-[10px] text-solana-mint font-mono">Guardado ✓</span>
            )}
            <button
              type="button"
              onClick={() => void persistPlannerProfile()}
              disabled={!auth.currentUser}
              className="text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg bg-solana-violet/30 text-solana-mint border border-solana-mint/30 disabled:opacity-40"
            >
              Guardar ubicación
            </button>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-neutral-800 bg-neutral-900/60">
        <p className="text-[11px] font-bold text-solana-mint uppercase tracking-wider mb-1">
          Antes de pedir tu plan
        </p>
        <p className="text-[10px] text-gray-500 mb-2 leading-snug">
          Marca cada ítem. Athena no sustituye líneas de emergencia, denuncia ni asesoría legal; genera un guion
          de apoyo.
        </p>
        <ul className="space-y-2">
          {(
            [
              ['safety', 'Estoy en un entorno donde puedo chatear con relativa seguridad.'] as const,
              ['privacy', 'Entiendo que debo evitar que otras personas lean la pantalla sin mi consentimiento.'] as const,
              ['truthful', 'Compartiré información que sea verdad a mi mejor conocimiento (incl. contacto de emergencia si aplica).'] as const,
              ['contactAware', 'Sé que el plan puede usar un contacto seguro o billetera que yo indique para retiros.'] as const,
            ] as const
          ).map(([key, label]) => (
            <li key={key} className="flex items-start gap-2">
              <input
                id={`prep-${key}`}
                type="checkbox"
                checked={prepChecks[key as keyof typeof prepChecks]}
                onChange={() =>
                  setPrepChecks((p) => ({
                    ...p,
                    [key]: !p[key as keyof typeof prepChecks],
                  }))
                }
                className="mt-0.5 rounded border-neutral-600 text-solana-mint focus:ring-solana-mint"
              />
              <label htmlFor={`prep-${key}`} className="text-[11px] text-gray-300 leading-snug cursor-pointer">
                {label}
              </label>
            </li>
          ))}
        </ul>
        {!prepComplete && (
          <p className="text-[10px] text-amber-400/90 mt-2">
            Debes marcar todas las casillas para enviar mensajes al planner.
          </p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth" ref={scrollRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed shadow-sm ${
                msg.role === 'user'
                  ? 'bg-gradient-to-br from-solana-violet to-solana-mint text-black rounded-br-none font-medium'
                  : 'bg-neutral-800 text-gray-200 rounded-bl-none border border-solana-violet/20'
              }`}
            >
              {msg.text}
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start animate-in fade-in duration-300">
            <div className="bg-neutral-800 rounded-2xl p-4 rounded-bl-none flex gap-1 items-center h-12 border border-neutral-700">
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></span>
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-75"></span>
              <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce delay-150"></span>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 bg-neutral-900 border-t border-solana-violet/20">
        <div className="flex gap-2">
          <input
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Escribe aquí…"
            className="flex-1 bg-black border border-neutral-700 rounded-xl px-4 py-3 text-white focus:border-solana-mint outline-none transition placeholder-gray-600"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!inputText.trim() || isTyping || !prepComplete}
            className="bg-solana-gradient text-black p-3 rounded-xl transition shadow-lg shadow-solana-violet/20 disabled:opacity-50 disabled:cursor-not-allowed font-bold"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default EscapePlanner;