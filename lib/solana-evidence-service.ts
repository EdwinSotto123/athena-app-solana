/**
 * Evidence storage on Solana via the SPL Memo Program.
 *
 * Equivalent of the EVM `storeEvidenceHash` (which writes the hash to
 * tx calldata). The Memo Program is a public, well-known program at
 * `MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr` whose only job is to
 * record a UTF-8 string in the transaction logs — perfect for an
 * immutable evidence log that's cheap (~5000 lamports / tx).
 *
 * For the MVP we keep the same `ATHENA_EVIDENCE:` prefix the EVM service
 * uses, so off-chain indexers and the Evidence Locker UI keep working.
 */

import {
    Connection,
    Keypair,
    Transaction,
    sendAndConfirmTransaction,
} from '@solana/web3.js';
import { createMemoInstruction } from '@solana/spl-memo';

const EVIDENCE_PREFIX = 'ATHENA_EVIDENCE:';

/** SPL Memo allows at most 566 bytes of UTF-8; stay slightly under for safety. */
const MEMO_MAX_BYTES = 560;

function truncateUtf8ToMaxBytes(input: string, maxBytes: number): string {
    const enc = new TextEncoder();
    const buf = enc.encode(input);
    if (buf.length <= maxBytes) return input;
    let end = maxBytes;
    // Avoid splitting a multibyte code point (continuation bytes are 10xxxxxx).
    while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
    return new TextDecoder('utf-8', { fatal: false }).decode(buf.slice(0, end));
}

/** Memo payload constructor — kept identical across chains for indexer parity. */
export function buildEvidencePayload(hash: string, metadata?: string): string {
    return metadata ? `${EVIDENCE_PREFIX}${hash}:${metadata}` : `${EVIDENCE_PREFIX}${hash}`;
}

/**
 * Send a Memo Program instruction containing the evidence hash.
 *
 * The signer becomes the implicit "author" of the memo (the memo program
 * checks for at least one signer when an authority list is provided).
 */
export async function storeEvidenceMemo(
    connection: Connection,
    signer: Keypair,
    hash: string,
    metadata?: string,
): Promise<string> {
    const payload = buildEvidencePayload(hash, metadata);

    // Memo program enforces a 566 **byte** UTF-8 limit (not JS string length).
    const safePayload = truncateUtf8ToMaxBytes(payload, MEMO_MAX_BYTES);

    const ix = createMemoInstruction(safePayload, [signer.publicKey]);
    const tx = new Transaction().add(ix);

    const sig = await sendAndConfirmTransaction(connection, tx, [signer], {
        commitment: 'confirmed',
    });
    return sig;
}

/** Quick parser for off-chain code reading historical memos. */
export function parseEvidenceMemo(
    memo: string,
): { hash: string; metadata?: string } | null {
    if (!memo.startsWith(EVIDENCE_PREFIX)) return null;
    const rest = memo.slice(EVIDENCE_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep === -1) return { hash: rest };
    return { hash: rest.slice(0, sep), metadata: rest.slice(sep + 1) };
}
