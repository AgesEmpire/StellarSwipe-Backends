import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

export interface WebhookSecretState {
  secret: string;
  nextSecret?: string;
  rotationStartedAt?: Date;
  rotationFinalizesAt?: Date;
}

/**
 * Outbound signing algorithm versions. Each version pins a specific HMAC
 * algorithm so a subscriber can tell, unambiguously, which algorithm to use
 * to recompute the digest — no coordination required beyond reading the
 * version tag on the header itself.
 *
 * `v1` (sha256) is the long-standing default and MUST stay the one we sign
 * with until subscribers have explicitly opted into a newer version, since
 * existing integrations verify against it. `v2` (sha512) exists so a future
 * migration has somewhere to go without breaking anyone still on `v1`.
 */
export type SignatureVersion = 'v1' | 'v2';

export const SIGNATURE_ALGORITHM_BY_VERSION: Record<SignatureVersion, 'sha256' | 'sha512'> = {
  v1: 'sha256',
  v2: 'sha512',
};

export const SUPPORTED_SIGNATURE_VERSIONS: SignatureVersion[] = ['v1', 'v2'];

/** Version used to sign new outbound deliveries. */
export const CURRENT_SIGNATURE_VERSION: SignatureVersion = 'v1';

export function isSupportedSignatureVersion(value: string): value is SignatureVersion {
  return (SUPPORTED_SIGNATURE_VERSIONS as string[]).includes(value);
}

export interface ParsedVersionedSignature {
  version: SignatureVersion;
  hex: string;
}

/**
 * Parses a `<version>=<hex>` signature header value, e.g. `v1=abc123...`.
 * Falls back to treating a bare `sha256=<hex>` / raw-hex header (our legacy,
 * unversioned format) as `v1` so already-registered subscribers keep
 * verifying without any change on their end.
 *
 * Returns `null` when the header names a version we don't recognize, or
 * isn't shaped like a signature at all — callers must treat that as a
 * verification failure, not throw.
 */
export function parseVersionedSignature(signature: string): ParsedVersionedSignature | null {
  if (!signature) return null;

  const versionedMatch = /^(v\d+)=([a-f0-9]+)$/i.exec(signature.trim());
  if (versionedMatch) {
    const [, version, hex] = versionedMatch;
    const normalizedVersion = version.toLowerCase();
    if (!isSupportedSignatureVersion(normalizedVersion)) return null;
    return { version: normalizedVersion, hex };
  }

  const legacyMatch = /^(?:sha256=)?([a-f0-9]+)$/i.exec(signature.trim());
  if (legacyMatch) {
    return { version: 'v1', hex: legacyMatch[1] };
  }

  return null;
}

@Injectable()
export class SignatureGeneratorService {
  generateSignature(
    payload: object,
    secret: string,
    version: SignatureVersion = CURRENT_SIGNATURE_VERSION,
  ): string {
    const message = JSON.stringify(payload);
    const algorithm = SIGNATURE_ALGORITHM_BY_VERSION[version];
    return crypto.createHmac(algorithm, secret).update(message).digest('hex');
  }

  /** Builds the `<version>=<hex>` value sent on `X-StellarSwipe-Signature`. */
  generateVersionedSignatureHeader(
    payload: object,
    secret: string,
    version: SignatureVersion = CURRENT_SIGNATURE_VERSION,
  ): string {
    return `${version}=${this.generateSignature(payload, secret, version)}`;
  }

  generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  generateDeliveryId(): string {
    return uuidv4();
  }

  /**
   * Verifies a signature against `secret`. `signature` may be a versioned
   * header value (`v1=<hex>`, `v2=<hex>`) or the legacy unversioned
   * `sha256=<hex>` / raw-hex form, which is treated as `v1`. An unsupported
   * or malformed version fails safely — it returns `false` rather than
   * throwing, so callers don't need a separate error-handling path to
   * reject a signature from an algorithm they don't speak.
   */
  verifySignature(payload: object, secret: string, signature: string): boolean {
    const parsed = parseVersionedSignature(signature);
    if (!parsed) return false;

    const expected = this.generateSignature(payload, secret, parsed.version);
    const signatureBuffer = Buffer.from(parsed.hex, 'hex');
    const expectedBuffer = Buffer.from(expected, 'hex');
    if (signatureBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  }

  signWithWebhookSecret(payload: object, webhook: WebhookSecretState): string {
    return this.generateVersionedSignatureHeader(payload, webhook.secret);
  }

  verifyWebhookSignature(payload: object, webhook: WebhookSecretState, signature: string): boolean {
    const now = new Date();
    const isInRotationWindow = webhook.rotationStartedAt && webhook.rotationFinalizesAt &&
      now >= webhook.rotationStartedAt && now <= webhook.rotationFinalizesAt;

    if (this.verifySignature(payload, webhook.secret, signature)) {
      return true;
    }

    if (isInRotationWindow && webhook.nextSecret) {
      return this.verifySignature(payload, webhook.nextSecret, signature);
    }

    return false;
  }

  initiateRotation(webhook: WebhookSecretState, rotationWindowMs: number): WebhookSecretState {
    return {
      ...webhook,
      nextSecret: this.generateSecret(),
      rotationStartedAt: new Date(),
      rotationFinalizesAt: new Date(Date.now() + rotationWindowMs),
    };
  }

  finalizeRotation(webhook: WebhookSecretState): WebhookSecretState {
    return {
      secret: webhook.nextSecret || webhook.secret,
      nextSecret: undefined,
      rotationStartedAt: undefined,
      rotationFinalizesAt: undefined,
    };
  }
}
