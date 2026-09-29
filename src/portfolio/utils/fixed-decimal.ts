/**
 * Fixed-point helpers for 8-decimal amounts (matches numeric(28,8) columns).
 * Values are held as bigint "units" of 1e-8 to avoid float drift.
 */
export const SCALE = 8;
const FACTOR = 10n ** BigInt(SCALE);

export function toUnits(value: string | number): bigint {
  const str = typeof value === 'number' ? value.toFixed(SCALE + 2) : value.trim();
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(str);
  if (!match || (match[2] === '' && !match[3])) throw new Error(`Invalid decimal: ${value}`);
  const [, sign, int, frac = ''] = match;
  const padded = (frac + '0'.repeat(SCALE + 1)).slice(0, SCALE + 1);
  let units = BigInt(int || '0') * FACTOR + BigInt(padded.slice(0, SCALE));
  if (Number(padded[SCALE]) >= 5) units += 1n; // round half up
  return sign ? -units : units;
}

export function fromUnits(units: bigint): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const int = abs / FACTOR;
  const frac = (abs % FACTOR).toString().padStart(SCALE, '0');
  return `${negative ? '-' : ''}${int}.${frac}`;
}

/** (a * b) / c with half-up rounding, all in units. */
export function mulDiv(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error('Division by zero');
  const product = a * b;
  const quotient = product / c;
  const remainder = product % c;
  return remainder * 2n >= c ? quotient + 1n : quotient;
}

export function mulUnits(a: bigint, b: bigint): bigint {
  return mulDiv(a, b, FACTOR);
}
