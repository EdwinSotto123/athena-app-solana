/**
 * IPFS Service using Pinata
 * 
 * Uploads files to IPFS via Pinata and returns the CID
 * for permanent, decentralized storage of evidence.
 */

import { ACTIVE_CHAIN, getExplorer } from './chain-router';
import { parseDataUrlParts } from './data-url';

// Pinata API endpoints
const PINATA_API_URL = 'https://api.pinata.cloud';
const PINATA_GATEWAY = 'https://gateway.pinata.cloud/ipfs';
const PUBLIC_GATEWAY = 'https://ipfs.io/ipfs';

// JWT solo en cliente si usas Pinata directo (desarrollo legacy). En Vercel: no pongas VITE_PINATA_JWT y usa /api/ipfs/upload.
const getPinataJWT = (): string | null => {
    const env = (import.meta as any).env;
    if (env?.VITE_PINATA_JWT) {
        return env.VITE_PINATA_JWT;
    }
    return null;
};

function shouldUseServerIpfs(): boolean {
    const env = (import.meta as any).env ?? {};
    if (env.VITE_IPFS_USE_SERVER === 'false') return false;
    if (getPinataJWT()) return false;
    return true;
}

function ipfsUploadApiUrl(): string {
    const env = (import.meta as any).env ?? {};
    const u = (env.VITE_IPFS_UPLOAD_URL || '/api/ipfs/upload').trim();
    return u.replace(/\/$/, '');
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(String(r.result));
        r.onerror = () => reject(new Error('FileReader failed'));
        r.readAsDataURL(blob);
    });
}

async function uploadBlobViaServer(
    blob: Blob,
    filename: string,
    metadata: EvidenceMetadata,
): Promise<IPFSUploadResult> {
    try {
        const dataUrl = await blobToDataUrl(blob);
        const res = await fetch(ipfsUploadApiUrl(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                content: dataUrl,
                filename,
                contentType: blob.type || 'application/octet-stream',
                metadata: {
                    type: metadata.type,
                    description: metadata.description,
                    caseId: metadata.caseId,
                },
            }),
        });
        const j = (await res.json()) as {
            success?: boolean;
            cid?: string;
            ipfsUrl?: string;
            gatewayUrl?: string;
            size?: number;
            timestamp?: string;
            error?: string;
            details?: string;
        };
        if (!res.ok || !j.success || !j.cid) {
            return {
                success: false,
                cid: '',
                ipfsUrl: '',
                gatewayUrl: '',
                size: 0,
                timestamp: new Date(),
                error: j.error || j.details || `HTTP ${res.status}`,
            };
        }
        return {
            success: true,
            cid: j.cid,
            ipfsUrl: j.ipfsUrl || `ipfs://${j.cid}`,
            gatewayUrl: j.gatewayUrl || `${PUBLIC_GATEWAY}/${j.cid}`,
            size: j.size ?? 0,
            timestamp: new Date(j.timestamp || Date.now()),
        };
    } catch (e: unknown) {
        return {
            success: false,
            cid: '',
            ipfsUrl: '',
            gatewayUrl: '',
            size: 0,
            timestamp: new Date(),
            error: e instanceof Error ? e.message : 'IPFS API error',
        };
    }
}

export interface IPFSUploadResult {
    success: boolean;
    cid: string;
    ipfsUrl: string;
    gatewayUrl: string;
    size: number;
    timestamp: Date;
    error?: string;
}

export interface EvidenceMetadata {
    type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO';
    description: string;
    timestamp: number;
    caseId?: string;
    hash?: string;
}

/**
 * Upload a file to IPFS via Pinata
 */
export async function uploadToIPFS(
    file: File | Blob,
    metadata: EvidenceMetadata
): Promise<IPFSUploadResult> {
    if (shouldUseServerIpfs()) {
        const filename =
            file instanceof File ? file.name : `athena-evidence-${Date.now()}`;
        return uploadBlobViaServer(file, filename, metadata);
    }

    const jwt = getPinataJWT();

    if (!jwt) {
        console.warn('[IPFS] No Pinata JWT ni servidor /api/ipfs — modo demo');
        return generateDemoResult(metadata);
    }

    try {
        // Create form data
        const formData = new FormData();
        formData.append('file', file);

        // Add Pinata metadata
        const pinataMetadata = JSON.stringify({
            name: `athena-evidence-${Date.now()}`,
            keyvalues: {
                type: metadata.type,
                description: metadata.description.substring(0, 100),
                timestamp: metadata.timestamp.toString(),
                caseId: metadata.caseId || 'anonymous'
            }
        });
        formData.append('pinataMetadata', pinataMetadata);

        // Pinata options
        const pinataOptions = JSON.stringify({
            cidVersion: 1
        });
        formData.append('pinataOptions', pinataOptions);

        // Upload to Pinata
        const response = await fetch(`${PINATA_API_URL}/pinning/pinFileToIPFS`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${jwt}`
            },
            body: formData
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Pinata upload failed: ${error}`);
        }

        const result = await response.json();
        const cid = result.IpfsHash;

        console.log('[IPFS] File uploaded successfully:', cid);

        return {
            success: true,
            cid,
            ipfsUrl: `ipfs://${cid}`,
            gatewayUrl: `${PUBLIC_GATEWAY}/${cid}`,
            size: result.PinSize,
            timestamp: new Date()
        };

    } catch (error: any) {
        console.error('[IPFS] Upload error:', error);
        return {
            success: false,
            cid: '',
            ipfsUrl: '',
            gatewayUrl: '',
            size: 0,
            timestamp: new Date(),
            error: error.message
        };
    }
}

/**
 * Upload text content to IPFS
 */
export async function uploadTextToIPFS(
    text: string,
    metadata: EvidenceMetadata
): Promise<IPFSUploadResult> {
    const blob = new Blob([text], { type: 'text/plain' });
    return uploadToIPFS(blob, metadata);
}

/**
 * Upload base64 data to IPFS (for images/audio from canvas/recorder)
 */
export async function uploadBase64ToIPFS(
    base64Data: string,
    mimeType: string,
    metadata: EvidenceMetadata
): Promise<IPFSUploadResult> {
    if (shouldUseServerIpfs()) {
        const parsed = parseDataUrlParts(base64Data, mimeType);
        const content =
            parsed != null
                ? `data:${parsed.mimeType};base64,${parsed.base64}`
                : base64Data.includes('data:')
                  ? base64Data
                  : `data:${mimeType};base64,${base64Data.replace(/^data:[^;]+;base64,/, '')}`;
        const ct = parsed?.mimeType || mimeType || 'application/octet-stream';
        try {
            const res = await fetch(ipfsUploadApiUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    content,
                    filename: `athena-evidence-${Date.now()}`,
                    contentType: ct,
                    metadata: {
                        type: metadata.type,
                        description: metadata.description,
                        caseId: metadata.caseId,
                    },
                }),
            });
            const j = (await res.json()) as {
                success?: boolean;
                cid?: string;
                ipfsUrl?: string;
                gatewayUrl?: string;
                size?: number;
                timestamp?: string;
                error?: string;
                details?: string;
            };
            if (!res.ok || !j.success || !j.cid) {
                return {
                    success: false,
                    cid: '',
                    ipfsUrl: '',
                    gatewayUrl: '',
                    size: 0,
                    timestamp: new Date(),
                    error: j.error || j.details || `HTTP ${res.status}`,
                };
            }
            return {
                success: true,
                cid: j.cid,
                ipfsUrl: j.ipfsUrl || `ipfs://${j.cid}`,
                gatewayUrl: j.gatewayUrl || `${PUBLIC_GATEWAY}/${j.cid}`,
                size: j.size ?? 0,
                timestamp: new Date(j.timestamp || Date.now()),
            };
        } catch (e: unknown) {
            return {
                success: false,
                cid: '',
                ipfsUrl: '',
                gatewayUrl: '',
                size: 0,
                timestamp: new Date(),
                error: e instanceof Error ? e.message : 'IPFS API error',
            };
        }
    }

    const parsed = parseDataUrlParts(base64Data, mimeType);
    if (!parsed) {
        return {
            success: false,
            cid: '',
            ipfsUrl: '',
            gatewayUrl: '',
            size: 0,
            timestamp: new Date(),
            error: 'Invalid base64 / data URL',
        };
    }
    let binaryString: string;
    try {
        binaryString = atob(parsed.base64);
    } catch {
        return {
            success: false,
            cid: '',
            ipfsUrl: '',
            gatewayUrl: '',
            size: 0,
            timestamp: new Date(),
            error: 'Base64 decode failed',
        };
    }
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: parsed.mimeType });

    return uploadToIPFS(blob, metadata);
}

/**
 * Generate demo result when no Pinata JWT is available
 */
function generateDemoResult(metadata: EvidenceMetadata): IPFSUploadResult {
    // Generate fake but realistic-looking CID
    const fakeCid = 'Qm' + Array(44).fill(0).map(() =>
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.charAt(
            Math.floor(Math.random() * 62)
        )
    ).join('');

    return {
        success: true,
        cid: fakeCid,
        ipfsUrl: `ipfs://${fakeCid}`,
        gatewayUrl: `${PUBLIC_GATEWAY}/${fakeCid}`,
        size: Math.floor(Math.random() * 100000) + 1000,
        timestamp: new Date()
    };
}

/**
 * Check if a CID is pinned on Pinata
 */
export async function checkPinStatus(cid: string): Promise<boolean> {
    const jwt = getPinataJWT();
    if (!jwt) return false;

    try {
        const response = await fetch(
            `${PINATA_API_URL}/data/pinList?status=pinned&hashContains=${cid}`,
            {
                headers: {
                    'Authorization': `Bearer ${jwt}`
                }
            }
        );
        const result = await response.json();
        return result.count > 0;
    } catch {
        return false;
    }
}

/**
 * Generate a shareable evidence URL
 */
export function getEvidenceUrl(cid: string): string {
    return `${PUBLIC_GATEWAY}/${cid}`;
}

/**
 * Generate evidence certificate data
 */
export function generateCertificate(
    cid: string,
    txHash: string,
    metadata: EvidenceMetadata
): {
    title: string;
    content: string;
    verificationUrl: string;
} {
    const date = new Date(metadata.timestamp);
    const explorer = getExplorer();
    const chainLabel = ACTIVE_CHAIN === 'solana' ? 'Solana Devnet' : 'Fraxtal';

    return {
        title: 'Athena Evidence Certificate',
        content: `
ATHENA IMMUTABLE EVIDENCE CERTIFICATE
=====================================

Evidence Type: ${metadata.type}
Description: ${metadata.description}
Timestamp: ${date.toISOString()}

IPFS Content ID (CID):
${cid}

Blockchain Transaction:
${txHash}

Verification Links:
• IPFS: ${PUBLIC_GATEWAY}/${cid}
• Blockchain (${explorer.name}): ${explorer.txUrl(txHash)}

This evidence was securely stored on the decentralized IPFS network
and its hash was recorded on the ${chainLabel} blockchain, providing
immutable proof of existence at the recorded timestamp.

Generated by Athena - Protecting Those Who Need It Most
        `.trim(),
        verificationUrl: `${PUBLIC_GATEWAY}/${cid}`
    };
}

export default {
    uploadToIPFS,
    uploadTextToIPFS,
    uploadBase64ToIPFS,
    checkPinStatus,
    getEvidenceUrl,
    generateCertificate
};
