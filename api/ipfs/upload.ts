/**
 * Vercel Serverless — subida a Pinata sin exponer el JWT al navegador.
 *
 * Variable SOLO en servidor:
 *   PINATA_JWT
 *
 * El cliente llama a POST /api/ipfs/upload (mismo origen en Vercel).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const PINATA_JWT = process.env.PINATA_JWT || '';
const PINATA_API_URL = 'https://api.pinata.cloud';
const PUBLIC_GATEWAY = 'https://ipfs.io/ipfs';

interface Body {
  content: string;
  filename?: string;
  contentType?: string;
  metadata?: {
    type?: string;
    description?: string;
    caseId?: string;
  };
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

  if (!PINATA_JWT) {
    console.warn('[api/ipfs/upload] PINATA_JWT no configurado — modo demo');
    const fakeCid =
      'Qm' +
      Array(44)
        .fill(0)
        .map(() =>
          'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
            Math.floor(Math.random() * 62),
          ),
        )
        .join('');
    return res.status(200).json({
      success: true,
      cid: fakeCid,
      ipfsUrl: `ipfs://${fakeCid}`,
      gatewayUrl: `${PUBLIC_GATEWAY}/${fakeCid}`,
      size: 0,
      demo: true,
    });
  }

  const { content, filename, contentType, metadata }: Body = req.body || {};
  if (!content) {
    return res.status(400).json({ success: false, error: 'content is required' });
  }

  try {
    let base64Data = content;
    if (content.includes(',')) {
      base64Data = content.split(',')[1];
    }

    const buffer = Buffer.from(base64Data, 'base64');
    const ct = contentType || 'application/octet-stream';
    const isText = ct.startsWith('text/') || ct === 'application/json';

    if (isText) {
      const textContent = buffer.toString('utf-8');
      const response = await fetch(`${PINATA_API_URL}/pinning/pinJSONToIPFS`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${PINATA_JWT}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pinataContent: {
            content: textContent,
            type: metadata?.type || 'TEXT',
            timestamp: Date.now(),
          },
          pinataMetadata: { name: filename || `athena-evidence-${Date.now()}` },
          pinataOptions: { cidVersion: 1 },
        }),
      });

      const responseText = await response.text();
      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          error: 'Pinata upload failed',
          details: responseText,
        });
      }

      const result = JSON.parse(responseText);
      const cid = result.IpfsHash as string;
      return res.status(200).json({
        success: true,
        cid,
        ipfsUrl: `ipfs://${cid}`,
        gatewayUrl: `${PUBLIC_GATEWAY}/${cid}`,
        size: result.PinSize || textContent.length,
        timestamp: new Date().toISOString(),
      });
    }

    const response = await fetch(`${PINATA_API_URL}/pinning/pinJSONToIPFS`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PINATA_JWT}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pinataContent: {
          data: base64Data,
          mimeType: ct,
          filename: filename || `evidence-${Date.now()}`,
          type: metadata?.type || 'MEDIA',
          description: metadata?.description || '',
          timestamp: Date.now(),
        },
        pinataMetadata: {
          name: filename || `athena-evidence-${Date.now()}`,
          keyvalues: {
            type: metadata?.type || 'UNKNOWN',
            contentType: ct,
            caseId: metadata?.caseId || 'anonymous',
          },
        },
        pinataOptions: { cidVersion: 1 },
      }),
    });

    const responseText = await response.text();
    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        error: 'Pinata upload failed',
        details: responseText,
      });
    }

    const result = JSON.parse(responseText);
    const cid = result.IpfsHash as string;
    return res.status(200).json({
      success: true,
      cid,
      ipfsUrl: `ipfs://${cid}`,
      gatewayUrl: `${PUBLIC_GATEWAY}/${cid}`,
      size: result.PinSize || buffer.length,
      timestamp: new Date().toISOString(),
    });
  } catch (e: unknown) {
    console.error('[api/ipfs/upload]', e);
    return res.status(500).json({
      success: false,
      error: e instanceof Error ? e.message : 'Internal server error',
    });
  }
}
