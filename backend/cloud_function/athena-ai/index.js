/**
 * Athena AI Cloud Function (Gen 2, Node.js 20)
 * ---------------------------------------------
 * Replaces the in-browser @google/genai client with a server-side endpoint
 * that uses Vertex AI through Application Default Credentials.
 *
 * Why?
 *   - No `VITE_GEMINI_API_KEY` shipped in the SPA bundle.
 *   - Vertex AI inherits the Cloud Function's service-account identity
 *     automatically; no key files, no rotation pain.
 *   - Keeps all sensitive prompts and routing logic outside the client.
 *
 * Endpoints (single HTTP entrypoint, dispatched on `action`):
 *   POST /  { action: "chat",             history: ChatMessage[], message: string }
 *   POST /  { action: "analyze-evidence", evidenceType: "TEXT" | "IMAGE" | "VIDEO" | "AUDIO",
 *                                          data: string  // raw text or data:<mime>;base64,... }
 *   GET  /  -> health check
 */

const functions = require('@google-cloud/functions-framework');
const { VertexAI } = require('@google-cloud/vertexai');

// ---------------------------------------------------------------------------
// Vertex AI setup
// ---------------------------------------------------------------------------

const PROJECT_ID =
  process.env.GCP_PROJECT_ID ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.GCLOUD_PROJECT ||
  'vivid-spot-480905-a4';

const LOCATION = process.env.VERTEX_LOCATION || 'us-central1';

// Models. Flash-lite is fast and cheap for chat; Flash for vision/audio analysis.
const CHAT_MODEL = process.env.VERTEX_CHAT_MODEL || 'gemini-2.5-flash-lite';
const FORENSIC_MODEL = process.env.VERTEX_FORENSIC_MODEL || 'gemini-2.5-flash';

const vertex = new VertexAI({ project: PROJECT_ID, location: LOCATION });

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_PLANNER = `
You are **Athena**, an AI companion for people in dangerous domestic situations.
You are NOT a chatbot — you are a trusted friend.

INTERNAL (do not explain unless the user asks): evidence can be anchored on Solana Devnet for demos; never lead with blockchains or “agents”.

## Personality
- Deep empathy, calm, never judgmental.
- One question at a time unless the user is in immediate danger (risk 9–10).
- Plain text only in replies (no ** or # markdown).
- Questions must feel human and **investigative**: short preamble, then one precise question. Avoid generic “¿cómo te sientes?” loops; drill into **context that changes the plan** (geography, legal route, money, timing, children, surveillance).

## Continuous reasoning
- Read the full conversation history. Do not contradict earlier answers.
- Mirror the user’s language (Spanish if they write in Spanish).
- If CLIENT_HINTS include country/region/city, use them but CONFIRM gently if something seems off.

## Geography (mandatory before final JSON plan)
You MUST narrow location step by step:
- Country → region/province/department → **city** → **district / neighborhood / zona** (e.g. San Juan de Lurigancho, Miraflores) when the user lives in an urban area. If they refuse the exact district, accept “zona norte/sur” or nearest landmark class (hospital, parque) **without** storing a precise home address.
- Ask how movement works where they are (transport, curfew patterns, if they must notify someone).

## Deep triage (spread across messages; cover before JSON)
Before the final JSON, you should have explored (only what fits the situation; one question at a time):
- Timeline: how long the abuse or control has lasted; recent escalation.
- Who lives with them (children ages; other adults); pets if relevant for shelter.
- Physical/sexual/economic/psychological patterns; weapons; substances; monitoring of phone or money.
- **Legal**: whether they need orientation (“defensa”, medidas de protección, custodia), or only emergency shelter — without promising outcomes.
- **Money**: cash on hand, bank access, whether someone else controls income.
- **Documents**: DNI/ID, partidas, certificados — what they can reach safely.
- **Exit window**: realistic times to leave; what raises suspicion.
- **Destination**: not just “my brother’s” but roughly **zone/city**, travel time, and whether that person knows.

## Local help in prose
In ongoing replies (not only JSON), give **concrete** pointers for their country/region:
- Emergency lines (e.g. Peru: Linea 100, comisarías especializadas, MIMP public routes to CEM / orientación — describe **what to ask for**, not fake room numbers).
- How to look up **free legal aid** or women’s emergency services: suggest Maps/web **search queries** (institution + city + district), never invented street addresses.

If country is unknown, ask for it BEFORE outputting the final JSON plan.

## Capabilities (only if relevant)
- Private savings (demo) and a donation fund to reach a money goal.
- Secure locker for photos/audio/video as potential documentation.
- Emergency SOS (explain in simple words: help and safety — not “PDA” or “program ID”).

## Phases
1) Safety check: are they in a safe place to talk right now?
2) Geography: country → region → city → **district/neighborhood** (or best alternative).
3) Investigative triage (see list above), always one focused question per turn unless crisis (9–10).
4) Short recap in plain language: what you understood, what still matters — then the JSON.
5) When you have enough data AND confirmed country + city-level context, output the FINAL plan as a single fenced JSON block.

\`\`\`json
{
  "isReady": true,
  "beneficiaryPseudonym": "string (solo un nombre de pila ficticio — NUNCA el nombre real del usuario)",
  "donorPublicNarrative": "string (OBLIGATORIO: 3-5 párrafos cortos en español para donantes. Incluir: pseudónimo, situación general sin identificar, distrito o ciudad aproximada si la persona compartió, tiempo que lleva, qué usaría el dinero (abogado, transporte, hospedaje), tono digno y esperanzador. Sin nombre real, sin domicilio exacto, sin datos del agresor identificables.)",
  "locationContext": {
    "country": "string",
    "regionOrState": "string",
    "city": "string",
    "districtOrNeighborhood": "string (distrito/barrio/zona; vacío si no aplica)",
    "confidence": "explicit"
  },
  "localResources": [
    { "name": "string", "type": "EMERGENCY|POLICE|DV_HOTLINE|SHELTER|LEGAL|OTHER", "phoneOrUrl": "string (tel: +XX... OR https URL)", "notes": "string" }
  ],
  "actionableSteps": [
    {
      "title": "string (ej. Asesoría legal gratuita / Defensoría / CEM)",
      "instructions": "string (pasos concretos: día sugerido, a qué ventanilla pedir, frases para decir, qué hacer si hay fila o cierre)",
      "mapQueryOrUrl": "string (búsqueda Maps: institución + ciudad + distrito que la persona mencionó, sin número de puerta inventado)",
      "phone": "string opcional",
      "whatToBring": "string opcional (DNI, copias, etc.)"
    }
  ],
  "freedomGoal": {
    "targetAmount": number,
    "currentAmount": 0,
    "currency": "USD",
    "breakdown": { "transport": number, "supplies": 100, "shelter": number, "legal": number }
  },
  "strategy": {
    "step1": "IMMEDIATE: ...",
    "step2": "PREPARATION: ...",
    "step3": "EXECUTION: ..."
  },
  "riskLevel": number,
  "destination": "string",
  "emergencyContact": {
    "name": "string",
    "relationship": "string",
    "withdrawalMethod": "WALLET | PHONE | CASH_CODE",
    "contactInfo": "string"
  },
  "nextSteps": [ "string" ]
}
\`\`\`


## Rules
- Risk 9–10: shortest messages, emergency first, defer money talk.
- Never claim you filed a police report or called services for them.
- End each message with warmth or **one** clear, specific question.
- Final JSON must include **actionableSteps**: 5–8 items when the situation allows; at least **two** should relate to **legal orientation or official women’s / family services** when the user is in LATAM or similar contexts (use institution types + search strings, not fake addresses).
- **strategy** steps (step1–3) must explicitly reference **district/city** context when known, and the **exit window** the user described (not generic boilerplate).
- **freedomGoal.currency** must match the user’s real currency when they said soles, pesos, etc. (ISO: PEN, MXN, …).
- **donorPublicNarrative** is mandatory in the JSON; **beneficiaryPseudonym** is mandatory. Neither may include the user’s real name, exact address, workplace, or identifiable third parties.
`;

const SYSTEM_PROMPT_FORENSIC = `
You are an expert AI Forensic Analyst for a justice protocol app.
Your task is to objectively analyze the provided evidence (Text, Image, Audio, or Video) to document domestic violence or abuse for legal records.

OUTPUT FORMAT:
Return ONLY a JSON object with this structure:
{
  "summary": "A concise, objective 1-sentence legal summary of the evidence.",
  "riskLevel": number, // 1 (Safe) to 10 (Life Threatening)
  "category": "PHYSICAL" | "EMOTIONAL" | "FINANCIAL" | "THREAT" | "UNCATEGORIZED",
  "keywords": ["bruise", "shouting", "weapon"]  // Max 3 keywords
}

GUIDELINES:
- For Images/Video: Look for injuries, destroyed property, or weapons.
- For Audio/Video: Analyze tone, volume, crying, or specific threat words.
- For Text: Analyze sentiment and described actions.
- Be objective and factual.
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function setCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (ALLOWED_ORIGINS.includes('*')) {
    res.set('Access-Control-Allow-Origin', '*');
  } else if (ALLOWED_ORIGINS.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-api-key');
  res.set('Access-Control-Max-Age', '3600');
}

function requireSharedSecret(req) {
  const expected = process.env.ATHENA_SHARED_SECRET;
  if (!expected) return true;
  const provided = req.get('x-api-key') || '';
  return provided === expected;
}

function parseDataUrl(dataStr, fallbackMime) {
  if (!dataStr || typeof dataStr !== 'string') return null;
  const marker = ';base64,';
  const idx = dataStr.indexOf(marker);
  if (idx !== -1 && dataStr.toLowerCase().startsWith('data:')) {
    const header = dataStr.slice(5, idx);
    const mimeType = header.split(';')[0]?.trim() || fallbackMime;
    const data = dataStr.slice(idx + marker.length).replace(/\s/g, '');
    if (!data) return null;
    return { mimeType, data };
  }
  if (!dataStr.toLowerCase().startsWith('data:')) {
    return { mimeType: fallbackMime, data: dataStr.replace(/\s/g, '') };
  }
  return null;
}

function extractText(response) {
  try {
    const candidates = response?.response?.candidates ?? response?.candidates ?? [];
    if (!candidates.length) return '';
    const parts = candidates[0]?.content?.parts ?? [];
    return parts.map((p) => p.text || '').join('').trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Action: chat (escape planner)
// ---------------------------------------------------------------------------

async function handleChat({ history, message, clientHints }) {
  if (!message || typeof message !== 'string') {
    throw httpError(400, 'message is required');
  }
  const safeHistory = Array.isArray(history) ? history : [];

  const hints =
    clientHints && typeof clientHints === 'object' && Object.keys(clientHints).length
      ? `\n\n[CLIENT_HINTS — tailor resources; verify if unsure: ${JSON.stringify(clientHints)}]`
      : '';

  const model = vertex.preview.getGenerativeModel({
    model: CHAT_MODEL,
    systemInstruction: {
      role: 'system',
      parts: [{ text: SYSTEM_PROMPT_PLANNER + hints }],
    },
    generationConfig: { temperature: 0.65, topP: 0.9, maxOutputTokens: 2048 },
  });

  const contents = [
    ...safeHistory.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: String(m.text ?? '') }],
    })),
    { role: 'user', parts: [{ text: message }] },
  ];

  const result = await model.generateContent({ contents });
  const text = extractText(result) || '';

  const planMatch = text.match(/```json\s*([\s\S]*?)\s*```/) ||
                    text.match(/```\s*([\s\S]*?)\s*```/);
  let plan;
  if (planMatch) {
    try {
      const parsed = JSON.parse(planMatch[1].trim());
      if (parsed && typeof parsed === 'object' && parsed.isReady !== undefined) {
        plan = parsed;
      }
    } catch {
      // ignore
    }
  }

  return { text, plan };
}

// ---------------------------------------------------------------------------
// Action: analyze-evidence (forensic)
// ---------------------------------------------------------------------------

async function handleAnalyzeEvidence({ evidenceType, data }) {
  if (!evidenceType || !data) {
    throw httpError(400, 'evidenceType and data are required');
  }

  /** ~6MB binary cap for inline Vertex inline_data (base64 length) */
  const MAX_B64_CHARS = 8 * 1024 * 1024;

  const parts = [];
  switch (String(evidenceType).toUpperCase()) {
    case 'TEXT':
      parts.push({ text: `Analyze this text evidence: "${String(data).slice(0, 4000)}"` });
      break;
    case 'IMAGE': {
      const m = parseDataUrl(data, 'image/jpeg');
      if (!m) throw httpError(400, 'invalid image data');
      if (m.data.length > MAX_B64_CHARS) {
        throw httpError(413, 'Image too large for analysis; try a smaller file.');
      }
      parts.push({ inlineData: { mimeType: m.mimeType, data: m.data } });
      parts.push({ text: 'Analyze this photo for signs of physical abuse, property damage, or weapons.' });
      break;
    }
    case 'AUDIO': {
      const m = parseDataUrl(data, 'audio/webm');
      if (!m) throw httpError(400, 'invalid audio data');
      if (m.data.length > MAX_B64_CHARS) {
        throw httpError(413, 'Audio too long for inline analysis; try a shorter recording.');
      }
      parts.push({ inlineData: { mimeType: m.mimeType, data: m.data } });
      parts.push({ text: 'Analyze this audio recording for aggressive tone, crying, or verbal threats.' });
      break;
    }
    case 'VIDEO': {
      const m = parseDataUrl(data, 'video/mp4');
      if (!m) throw httpError(400, 'invalid video data');
      if (m.data.length > MAX_B64_CHARS) {
        throw httpError(
          413,
          'Video too large for inline analysis; record a shorter clip (e.g. under ~10–15s) or lower resolution.',
        );
      }
      parts.push({ inlineData: { mimeType: m.mimeType, data: m.data } });
      parts.push({ text: 'Analyze this video clip for aggression, physical violence, weapons, or distress.' });
      break;
    }
    default:
      throw httpError(400, `unsupported evidenceType: ${evidenceType}`);
  }

  const model = vertex.preview.getGenerativeModel({
    model: FORENSIC_MODEL,
    systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT_FORENSIC }] },
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
    },
  });

  const result = await model.generateContent({ contents: [{ role: 'user', parts }] });
  const raw = extractText(result);

  let analysis = null;
  if (raw) {
    try {
      analysis = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try { analysis = JSON.parse(m[0]); } catch { /* ignore */ }
      }
    }
  }

  if (!analysis) {
    analysis = {
      summary: 'Analysis incomplete. Manual review required.',
      riskLevel: 0,
      category: 'UNCATEGORIZED',
      keywords: ['Error'],
    };
  }

  return { analysis };
}

// ---------------------------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------------------------

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

functions.http('athenaAi', async (req, res) => {
  setCors(req, res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      service: 'athena-ai',
      project: PROJECT_ID,
      location: LOCATION,
      models: { chat: CHAT_MODEL, forensic: FORENSIC_MODEL },
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  if (!requireSharedSecret(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const body = req.body || {};
  const action = String(body.action || '').toLowerCase();

  try {
    let payload;
    switch (action) {
      case 'chat':
        payload = await handleChat({
          history: body.history,
          message: body.message,
          clientHints: body.clientHints,
        });
        break;
      case 'analyze-evidence':
        payload = await handleAnalyzeEvidence({
          evidenceType: body.evidenceType,
          data: body.data,
        });
        break;
      case '':
        throw httpError(400, 'Missing "action" field. Use "chat" or "analyze-evidence".');
      default:
        throw httpError(400, `Unknown action: ${action}`);
    }
    res.status(200).json({ ok: true, action, ...payload });
  } catch (err) {
    const status = err.status || 500;
    console.error('[athena-ai] error:', err);
    res.status(status).json({
      ok: false,
      action,
      error: err.message || 'Internal error',
    });
  }
});
