/**
 * Athena AI client.
 *
 * Talks to the `athena-ai` Cloud Function (Vertex AI) instead of calling Gemini
 * directly from the browser. This means:
 *   - No `VITE_GEMINI_API_KEY` shipped in the SPA bundle.
 *   - All prompts and routing logic live server-side.
 *   - Vertex AI quota and auth come from the Cloud Function's service account.
 *
 * Configuration (.env / .env.local):
 *
 *   Producción (Vercel, recomendado): mismo origen + proxy
 *     Cliente (público):  VITE_AI_ENDPOINT_URL=/api/athena-ai
 *     Servidor (Vercel): ATHENA_AI_UPSTREAM_URL=https://...cloudfunctions.net/athena-ai
 *                        ATHENA_SHARED_SECRET=…   (opcional; no uses VITE_AI_SHARED_SECRET)
 *
 *   Desarrollo / sin proxy: URL directa a la Cloud Function
 *     VITE_AI_ENDPOINT_URL=https://us-central1-…/athena-ai
 *
 * If VITE_AI_ENDPOINT_URL is missing the helpers throw so the caller can fall
 * back to a local mock (we keep the Gemini browser path only as a last-resort
 * fallback inside `services/geminiService.ts`).
 */

import type { ChatMessage, EvidenceAnalysis, EvidenceType, EscapePlan } from '../types';

interface ChatResponse {
  ok: boolean;
  action: 'chat';
  text: string;
  plan?: EscapePlan;
  error?: string;
}

interface AnalyzeResponse {
  ok: boolean;
  action: 'analyze-evidence';
  analysis: EvidenceAnalysis;
  error?: string;
}

const env = (import.meta as any).env ?? {};

export const AI_ENDPOINT_URL: string = (env.VITE_AI_ENDPOINT_URL || '').trim();
/** Solo necesario si llamas a la Cloud Function directo desde el navegador; con /api/athena-ai el secreto va en Vercel. */
const AI_SHARED_SECRET: string = (env.VITE_AI_SHARED_SECRET || '').trim();

export const isAiEndpointConfigured = (): boolean => Boolean(AI_ENDPOINT_URL);

async function callEndpoint<T>(body: Record<string, unknown>): Promise<T> {
  if (!AI_ENDPOINT_URL) {
    throw new Error(
      '[aiClient] VITE_AI_ENDPOINT_URL not set. Deploy backend/cloud_function/athena-ai or fall back to demo mode.'
    );
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (AI_SHARED_SECRET) headers['x-api-key'] = AI_SHARED_SECRET;

  const res = await fetch(AI_ENDPOINT_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new Error(`[aiClient] HTTP ${res.status} (no JSON body)`);
  }

  if (!res.ok || json?.ok === false) {
    const reason = json?.error || `HTTP ${res.status}`;
    throw new Error(`[aiClient] ${body.action} failed: ${reason}`);
  }

  return json as T;
}

export type PlannerClientHints = {
  locale?: string;
  timeZone?: string;
  country?: string;
  region?: string;
  city?: string;
};

export async function aiChat(
  history: ChatMessage[],
  message: string,
  clientHints?: PlannerClientHints
): Promise<{ text: string; plan?: EscapePlan }> {
  const payload: Record<string, unknown> = {
    action: 'chat',
    history: history.map((m) => ({ role: m.role, text: m.text })),
    message,
  };
  if (clientHints && Object.keys(clientHints).length > 0) {
    payload.clientHints = clientHints;
  }
  const data = await callEndpoint<ChatResponse>(payload as any);
  return { text: data.text || '', plan: data.plan };
}

export async function aiAnalyzeEvidence(
  evidenceType: EvidenceType,
  data: string
): Promise<EvidenceAnalysis> {
  const res = await callEndpoint<AnalyzeResponse>({
    action: 'analyze-evidence',
    evidenceType,
    data,
  });
  return res.analysis;
}
