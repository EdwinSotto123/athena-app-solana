/** Precio spot SOL/USD (CoinGecko, sin API key). Para barras de progreso aproximadas. */
export async function fetchSolUsd(): Promise<number | null> {
  try {
    const r = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd',
    );
    if (!r.ok) return null;
    const j = (await r.json()) as { solana?: { usd?: number } };
    const n = j?.solana?.usd;
    return typeof n === 'number' && n > 0 ? n : null;
  } catch {
    return null;
  }
}
