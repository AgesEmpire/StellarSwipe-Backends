import * as crypto from 'crypto';

export function verifyHmacSHA256(rawBody: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // header may be like "sha256=..." or raw hex
  const received = signatureHeader.replace(/^sha256=/, '');
  const rb = Buffer.from(received, 'hex');
  const eb = Buffer.from(expected, 'hex');
  if (rb.length !== eb.length) return false;
  return crypto.timingSafeEqual(rb, eb);
}
