/**
 * Money is always an integer count of minor currency units.
 *
 * $75.00 is 7500, never 75.0. Floating point is never used for a monetary
 * value anywhere in Lacquer: `0.1 + 0.2 !== 0.3` is not an acceptable property
 * for a salon's prices. Parsing happens once at the edge (form input), and
 * formatting happens once at the edge (display); everything between is integer
 * arithmetic.
 *
 * The installation currency is single-valued and comes from configuration
 * (`INSTALLATION_CURRENCY`). Multi-currency behavior is deliberately absent.
 */
/** Largest representable amount, chosen to stay well inside a 32-bit integer column. */
export const maxMinorUnits = 100_000_000;
export class MoneyParseError extends Error {}
const currencyFormatters = new Map<string, Intl.NumberFormat>();
function currencyFormatter(currency: string, locale: string) {
  const key = `${locale}:${currency}`;
  let cached = currencyFormatters.get(key);
  if (!cached) {
    cached = new Intl.NumberFormat(locale, { style: 'currency', currency });
    currencyFormatters.set(key, cached);
  }
  return cached;
}
/** Minor units per major unit for a currency (100 for USD, 1 for JPY). */
export function minorUnitScale(currency: string, locale = 'en-US'): number {
  const digits =
    currencyFormatter(currency, locale).resolvedOptions()
      .maximumFractionDigits ?? 2;
  return 10 ** digits;
}
/** Render minor units for display: `formatMoney(7500, 'USD')` is `"$75.00"`. */
export function formatMoney(
  minorUnits: number,
  currency: string,
  locale = 'en-US',
): string {
  if (!Number.isInteger(minorUnits))
    throw new MoneyParseError('Money must be an integer of minor units');
  return currencyFormatter(currency, locale).format(
    minorUnits / minorUnitScale(currency, locale),
  );
}
/**
 * Render minor units as a bare decimal suitable for a number input, without a
 * currency symbol: `7500` becomes `"75.00"`.
 */
export function formatMoneyInput(
  minorUnits: number,
  currency: string,
  locale = 'en-US',
): string {
  const scale = minorUnitScale(currency, locale);
  const digits = Math.round(Math.log10(scale));
  return (minorUnits / scale).toFixed(digits);
}
/**
 * Parse operator input ("75", "75.5", "$75.00", "1,250.00") into minor units.
 *
 * Rejects anything that is not an exact number of minor units rather than
 * silently rounding a salon's price. Throws `MoneyParseError` on bad input so
 * callers can surface a field-level message.
 */
export function parseMoney(
  input: string,
  currency: string,
  locale = 'en-US',
): number {
  const cleaned = input
    .trim()
    .replace(/[\s,]/g, '')
    .replace(/^[^\d.-]+/, '');
  if (!/^-?\d*(?:\.\d+)?$/.test(cleaned) || cleaned === '' || cleaned === '.')
    throw new MoneyParseError('Enter an amount such as 75.00');
  const scale = minorUnitScale(currency, locale);
  const digits = Math.round(Math.log10(scale));
  const [whole = '0', fraction = ''] = cleaned.split('.');
  if (fraction.length > digits)
    throw new MoneyParseError(
      digits === 0
        ? 'This currency does not use decimal places'
        : `Use at most ${digits} decimal places`,
    );
  const negative = whole.startsWith('-');
  const magnitude =
    Number(whole.replace('-', '') || '0') * scale +
    Number(fraction.padEnd(digits, '0') || '0');
  if (!Number.isSafeInteger(magnitude) || magnitude > maxMinorUnits)
    throw new MoneyParseError('Amount is too large');
  return negative ? -magnitude : magnitude;
}
