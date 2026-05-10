/**
 * Vercel Serverless — proxy hacia la Cloud Function `athena-ai` (Vertex AI).
 *
 * Variables SOLO en Vercel (no VITE_*):
 *   ATHENA_AI_UPSTREAM_URL = https://us-central1-PROJECT.cloudfunctions.net/athena-ai
 *   ATHENA_SHARED_SECRET   = (opcional) misma que configuraste en la Cloud Function
 *
 * En el cliente (público):
 *   VITE_AI_ENDPOINT_URL=/api/athena-ai
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const upstream = (process.env.ATHENA_AI_UPSTREAM_URL || '').trim();
  if (!upstream || upstream.startsWith('/')) {
    console.error('[api/athena-ai] Falta ATHENA_AI_UPSTREAM_URL');
    return res.status(500).json({
      ok: false,
      error:
        'ATHENA_AI_UPSTREAM_URL no configurada. Añádela en Vercel (Environment Variables) apuntando a tu Cloud Function.',
    });
  }

  const secret = (process.env.ATHENA_SHARED_SECRET || '').trim();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) {
    headers['x-api-key'] = secret;
  }

  try {
    const r = await fetch(upstream, {
      method: 'POST',
      headers,
      body: JSON.stringify(req.body ?? {}),
    });

    const text = await r.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return res.status(502).json({
        ok: false,
        error: 'La función upstream devolvió texto no JSON',
        detail: text.slice(0, 300),
      });
    }
    return res.status(r.status).json(json);
  } catch (e: unknown) {
    console.error('[api/athena-ai]', e);
    return res.status(502).json({
      ok: false,
      error: e instanceof Error ? e.message : 'Error de proxy',
    });
  }
}
