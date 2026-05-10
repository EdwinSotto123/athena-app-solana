/** Formato de montos del plan según ISO 4217 (UI donaciones + EscapePlanner). */

export function planCurrencyPrefix(iso: string | undefined): string {
  const c = (iso || 'USD').toUpperCase().trim();
  switch (c) {
    case 'USD':
      return '$';
    case 'PEN':
      return 'S/';
    case 'EUR':
      return '€';
    case 'MXN':
      return 'MX$';
    case 'COP':
      return 'COL$';
    case 'ARS':
      return 'AR$';
    case 'CLP':
      return 'CLP ';
    case 'BRL':
      return 'R$';
    default:
      return '';
  }
}

export function formatPlanMoney(amount: number, currency: string | undefined): string {
  const code = (currency || 'USD').toUpperCase().trim();
  const n = Number.isFinite(amount) ? amount : 0;
  const p = planCurrencyPrefix(code);
  if (p) return `${p}${n}`;
  return `${n} ${code}`;
}
