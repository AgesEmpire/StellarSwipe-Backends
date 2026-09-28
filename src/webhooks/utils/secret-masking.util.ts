const VISIBLE_SUFFIX_LENGTH = 4;

/**
 * Masks a webhook signing secret for API responses, keeping only the last
 * few characters so subscribers can tell secrets apart.
 */
export function maskSecret(secret: string): string {
  if (secret.length <= VISIBLE_SUFFIX_LENGTH * 2) return '****';
  return `****${secret.slice(-VISIBLE_SUFFIX_LENGTH)}`;
}
