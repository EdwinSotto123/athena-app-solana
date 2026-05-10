/**
 * Athena AI service.
 *
 * Public API:
 *   - sendPlannerMessage(history, newMessage)
 *   - analyzeEvidence(type, data)
 *
 * Backend strategy (in priority order):
 *   1. Cloud Function (Vertex AI) at VITE_AI_ENDPOINT_URL  ← preferred, keyless
 *   2. In-browser @google/genai with VITE_GEMINI_API_KEY    ← legacy fallback
 *   3. Heuristic offline fallbacks (so the demo never crashes)
 *
 * The legacy fallback is kept only because the migration to the Cloud Function
 * is brand new; once the endpoint is live in every environment we can delete
 * the @google/genai dependency entirely.
 */

import { GoogleGenAI } from '@google/genai';
import {
  EscapePlan,
  ChatMessage,
  EvidenceAnalysis,
  EvidenceType,
} from '../types';
import {
  isAiEndpointConfigured,
  aiChat,
  aiAnalyzeEvidence,
  AI_ENDPOINT_URL,
  type PlannerClientHints,
} from './aiClient';
import { parseDataUrlParts } from '../lib/data-url';

let genAI: GoogleGenAI | null = null;

const getApiKey = (): string => {
  const env = (import.meta as any).env;
  return env?.VITE_GEMINI_API_KEY || '';
};

const getAI = () => {
  if (!genAI) {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.warn(
        '[Gemini] No API key found and no VITE_AI_ENDPOINT_URL set. Falling back to canned responses.'
      );
    }
    genAI = new GoogleGenAI({ apiKey });
  }
  return genAI;
};

// ---------------------------------------------------------------------------
// PLANNER (chat)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_PLANNER = `
You are **Athena**, companion for people in dangerous domestic situations—not a generic chatbot.

STYLE: plain text (no ** or #). Mirror the user's language. One focused, investigative question per turn unless risk 9–10.

GEOGRAPHY: country → region → city → district/neighborhood (no exact home address required). Ask about transport, surveillance, money, children, documents, legal needs, exit windows.

Never lead with blockchains. Solana only if user asks how proof is stored.

FINAL OUTPUT: When enough context exists, output ONE fenced \`\`\`json block with:
- beneficiaryPseudonym, donorPublicNarrative (3-5 short paragraphs for donors; mandatory; no real names or addresses)
- locationContext including districtOrNeighborhood when urban
- localResources, actionableSteps (5–8; include legal/women's institution *types* + Maps search strings; no fake street numbers)
- freedomGoal with correct ISO currency (PEN, USD, …), strategy referencing their district/timing, riskLevel, destination, emergencyContact, nextSteps
`;

const fallbackPlannerReply = (text: string): { text: string } => ({
  text:
    "I'm here for you, but my AI brain is offline right now. " +
    "Take a deep breath and try again in a moment. If you're in immediate " +
    'danger, call your local emergency number first. 💜',
});

export const sendPlannerMessage = async (
  history: ChatMessage[],
  newMessage: string,
  clientHints?: PlannerClientHints
): Promise<{ text: string; plan?: EscapePlan }> => {
  // 1. Cloud Function (preferred) — no API key in the browser bundle.
  if (isAiEndpointConfigured()) {
    try {
      return await aiChat(history, newMessage, clientHints);
    } catch (err: any) {
      console.error('[Athena] Cloud Function chat failed, attempting browser fallback:', err);
      // continue to legacy path below
    }
  }

  // 2. Legacy in-browser SDK fallback.
  if (getApiKey()) {
    try {
      const ai = getAI();
      let conversation = `System: ${SYSTEM_PROMPT_PLANNER}\n`;
      history.forEach((msg) => {
        conversation += `${msg.role === 'user' ? 'User' : 'Athena'}: ${msg.text}\n`;
      });
      conversation += `User: ${newMessage}\nAthena:`;

      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: conversation,
        config: { temperature: 0.7 },
      });

      const output = response.text || '';
      const jsonMatch =
        output.match(/```json\s*([\s\S]*?)\s*```/) ||
        output.match(/```\s*([\s\S]*?)\s*```/);

      if (jsonMatch) {
        try {
          const plan = JSON.parse(jsonMatch[1].trim()) as EscapePlan;
          return { text: 'Protocol generated.', plan };
        } catch {
          return { text: output };
        }
      }
      return { text: output };
    } catch (error: any) {
      console.error('Athena Brain Error:', error);
      if (error?.message?.includes('quota') || error?.message?.includes('limit')) {
        return {
          text: "I'm receiving a lot of messages right now. Please wait a moment and try again. 💜",
        };
      }
      if (error?.message?.includes('content') || error?.message?.includes('safety')) {
        return {
          text: "I understood what you said, but I need a bit more detail. Could you tell me more about your situation? 💜",
        };
      }
      return fallbackPlannerReply(newMessage);
    }
  }

  // 3. No backend at all. Provide a friendly demo reply.
  return fallbackPlannerReply(newMessage);
};

// ---------------------------------------------------------------------------
// FORENSIC ANALYSIS
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_FORENSIC = `
You are an expert AI Forensic Analyst for a justice protocol app.
Analyze the provided evidence (Text, Image, Audio, Video) and return ONLY a JSON object.
{
  "summary": "...",
  "riskLevel": 1-10,
  "category": "PHYSICAL"|"EMOTIONAL"|"FINANCIAL"|"THREAT"|"UNCATEGORIZED",
  "keywords": [up to 3 strings]
}
`;

const fallbackAnalysis = (): EvidenceAnalysis => ({
  summary: 'Analysis offline. Manual review required.',
  riskLevel: 0,
  category: 'UNCATEGORIZED',
  keywords: ['offline'],
});

export const analyzeEvidence = async (
  type: EvidenceType,
  data: string
): Promise<EvidenceAnalysis | null> => {
  // 1. Cloud Function (preferred)
  if (isAiEndpointConfigured()) {
    try {
      return await aiAnalyzeEvidence(type, data);
    } catch (err) {
      console.error('[Athena] Cloud Function analyze failed, attempting browser fallback:', err);
    }
  }

  // 2. Legacy in-browser SDK fallback (image/video/audio inline data still works there).
  if (!getApiKey()) {
    return fallbackAnalysis();
  }

  try {
    const ai = getAI();
    const parts: any[] = [];

    const getMimeAndData = (dataStr: string, defaultMime: string) => {
      const p = parseDataUrlParts(dataStr, defaultMime);
      if (p) return { mimeType: p.mimeType, data: p.base64 };
      return { mimeType: defaultMime, data: dataStr };
    };

    if (type === 'TEXT') {
      parts.push({ text: `Analyze this text evidence: "${data}"` });
    } else if (type === 'IMAGE') {
      const { mimeType, data: base64 } = getMimeAndData(data, 'image/jpeg');
      parts.push({ inlineData: { mimeType, data: base64 } });
      parts.push({
        text: 'Analyze this photo for signs of physical abuse, property damage, or weapons.',
      });
    } else if (type === 'AUDIO') {
      const { mimeType, data: base64 } = getMimeAndData(data, 'audio/webm');
      parts.push({ inlineData: { mimeType, data: base64 } });
      parts.push({
        text: 'Analyze this audio recording for aggressive tone, crying, or verbal threats.',
      });
    } else if (type === 'VIDEO') {
      const { mimeType, data: base64 } = getMimeAndData(data, 'video/mp4');
      parts.push({ inlineData: { mimeType, data: base64 } });
      parts.push({
        text: 'Analyze this video clip for aggression, physical violence, weapons, or distress.',
      });
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: { parts },
      config: {
        systemInstruction: SYSTEM_PROMPT_FORENSIC,
        responseMimeType: 'application/json',
      },
    });

    const jsonStr = response.text;
    if (jsonStr) return JSON.parse(jsonStr) as EvidenceAnalysis;
    return fallbackAnalysis();
  } catch (error) {
    console.error('Forensic Analysis Error:', error);
    return fallbackAnalysis();
  }
};

// Convenience export for diagnostics screens.
export const getAiBackendInfo = () => ({
  endpoint: AI_ENDPOINT_URL,
  endpointConfigured: isAiEndpointConfigured(),
  hasLegacyKey: Boolean(getApiKey()),
});
