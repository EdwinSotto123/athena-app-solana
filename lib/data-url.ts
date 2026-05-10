/**
 * Parse data: URLs where extra parameters appear before ";base64," —
 * e.g. data:video/webm;codecs=vp9,opus;base64,XXXX
 * Splitting on the first comma breaks those; we anchor on ";base64,".
 */
export function parseDataUrlParts(
  dataStr: string,
  fallbackMime: string,
): { mimeType: string; base64: string } | null {
  if (!dataStr || typeof dataStr !== 'string') return null;
  const marker = ';base64,';
  const idx = dataStr.indexOf(marker);
  if (idx !== -1 && dataStr.toLowerCase().startsWith('data:')) {
    const header = dataStr.slice(5, idx);
    const mimeType = header.split(';')[0]?.trim() || fallbackMime;
    const base64 = dataStr.slice(idx + marker.length).replace(/\s/g, '');
    if (!base64) return null;
    return { mimeType, base64 };
  }
  const trimmed = dataStr.trim();
  if (trimmed && !trimmed.toLowerCase().startsWith('data:')) {
    return { mimeType: fallbackMime, base64: trimmed.replace(/\s/g, '') };
  }
  return null;
}
