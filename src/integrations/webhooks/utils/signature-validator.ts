import { createHmac, timingSafeEqual } from 'crypto';

export type WebhookSignatureAlgorithm = 'sha256' | 'sha512';

interface VerifyWebhookSignatureInput {
  payload: Buffer | string;
  secret?: string;
  signature?: string | string[];
  algorithm?: WebhookSignatureAlgorithm;
}

export function createWebhookSignature(
  payload: Buffer | string,
  secret: string,
  algorithm: WebhookSignatureAlgorithm = 'sha256',
): string {
  return createHmac(algorithm, secret).update(payload).digest('hex');
}

export function normalizeWebhookSignature(
  signature?: string | string[],
): string | null {
  const candidate = Array.isArray(signature) ? signature[0] : signature;
  if (!candidate || candidate.trim() === '') return null;

  return candidate.trim().replace(/^sha(?:256|512)=/i, '');
}

export function verifyWebhookSignature({
  payload,
  secret,
  signature,
  algorithm = 'sha256',
}: VerifyWebhookSignatureInput): boolean {
  if (!secret || secret.trim() === '') return false;

  const normalizedSignature = normalizeWebhookSignature(signature);
  if (!normalizedSignature || !/^[a-f0-9]+$/i.test(normalizedSignature)) {
    return false;
  }

  const expectedSignature = createWebhookSignature(payload, secret, algorithm);
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const receivedBuffer = Buffer.from(normalizedSignature, 'hex');

  if (receivedBuffer.length !== expectedBuffer.length) return false;

  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
