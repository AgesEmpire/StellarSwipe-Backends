
/**
 * Utility for auditing webhook subscriber secrets.
 *
 * A strong secret meets two criteria:
 *   1. Minimum length (defaults to 32 characters).
 *   2. Shannon entropy per character >= MIN_ENTROPY_BITS_PER_CHAR (defaults to 3.5).
 */

export const MIN_SECRET_LENGTH = 32;
export const MIN_ENTROPY_BITS_PER_CHAR = 3.5;

export interface SecretEntropyResult {
  length: number;
  entropyBitsPerChar: number;
  isStrong: boolean;
  reason: string;
}

export function evaluateSecretStrength(secret: string): SecretEntropyResult {
  const length = secret.length;

  if (length < MIN_SECRET_LENGTH) {
    return {
      length,
      entropyBitsPerChar: 0,
      isStrong: false,
      reason: `Secret is too short (${length} chars, minimum ${MIN_SECRET_LENGTH})`,
    };
  }

  const entropy = shannonEntropy(secret);
  const bitsPerChar = length > 0 ? entropy / length : 0;

  if (bitsPerChar < MIN_ENTROPY_BITS_PER_CHAR) {
    return {
      length,
      entropyBitsPerChar: Number(bitsPerChar.toFixed(3)),
      isStrong: false,
      reason: `Entropy too low (${bitsPerChar.toFixed(3)} bits/char, minimum ${MIN_ENTROPY_BITS_PER_CHAR})`,
    };
  }

  return {
    length,
    entropyBitsPerChar: Number(bitsPerChar.toFixed(3)),
    isStrong: true,
    reason: 'Secret meets strength requirements',
  };
}

function shannonEntropy(str: string): number {
  if (str.length === 0) return 0;

  const freq = new Map<string, number>();
  for (const char of str) {
    freq.set(char, (freq.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  const len = str.length;
  for (const count of freq.values()) {
    const p = count / len;
    entropy -= p * Math.log2(p);
  }

  return entropy * len;
}

export function hashSecret(secret: string): string {
  const hash = Array.from(secret)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
  return `****${hash}…`;
}
