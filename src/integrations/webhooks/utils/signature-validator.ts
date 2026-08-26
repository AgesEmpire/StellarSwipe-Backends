import * as crypto from 'crypto';

export type HmacAlgorithm = 'sha256' | 'sha512';

export function verifyHmacSignature(
  rawBody: string,
  signatureHeader: string,
  secret: string,
  algorithm: HmacAlgorithm = 'sha256',
): boolean {
  if (!rawBody || !signatureHeader || !secret) return false;

  const expected = crypto
    .createHmac(algorithm, secret)
    .update(rawBody)
    .digest('hex');
  const received = signatureHeader.replace(/^sha(256|512)=/, '');

  if (!/^[a-f0-9]+$/i.test(received)) return false;

  const receivedBuffer = Buffer.from(received, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  if (receivedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

export const verifyHmacSHA256 = (
  rawBody: string,
  signatureHeader: string,
  secret: string,
): boolean => verifyHmacSignature(rawBody, signatureHeader, secret, 'sha256');
