import { createHmac, timingSafeEqual } from 'crypto';

/** Signed snapshot binding a confirmation to the exact previewed portfolio state. */
export interface CloseAllPreviewTokenPayload {
  v: 1;
  /** Preview id — also the idempotency key for confirmation. */
  pid: string;
  uid: string;
  /** Issued / expires, epoch ms. */
  iat: number;
  exp: number;
  /** Fingerprint of eligible + ineligible positions at preview time. */
  fp: string;
  /** Per eligible position: [version, estimated exit price]. */
  pos: Record<string, [number, number]>;
}

const b64url = (buf: Buffer) => buf.toString('base64url');

export function signPreviewToken(payload: CloseAllPreviewTokenPayload, secret: string): string {
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}

/** Returns the payload, or null if the token is malformed or its signature is wrong. */
export function verifyPreviewToken(token: string, secret: string): CloseAllPreviewTokenPayload | null {
  if (typeof token !== 'string') return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload?.v !== 1 || typeof payload.pid !== 'string' || typeof payload.uid !== 'string') return null;
    return payload as CloseAllPreviewTokenPayload;
  } catch {
    return null;
  }
}
