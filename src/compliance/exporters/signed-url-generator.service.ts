import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

export interface SignedUrlPayload {
  keyId: string;
  exportId: string;
  exportType: string;
  userId: string;
  filePath: string;
  format: string;
  issuedAt: number;
  expiresAt: number;
  signature: string;
}

type SignedFields = Omit<SignedUrlPayload, 'signature'>;

/**
 * Generates and validates signed, time-limited URLs for export file downloads.
 * Each signed URL is single-purpose, tied to a specific export, and cannot be reused.
 *
 * The service uses HMAC-SHA256 with a server secret to ensure URLs cannot be forged
 * or tampered with without detection. Every field that decides what gets served
 * (file path and format included) is covered by the signature, and the payload
 * names the key that signed it. SIGNED_URL_KEY_ID selects the active key; keys
 * rotated out are listed in SIGNED_URL_ROTATED_KEYS (JSON map of keyId -> secret)
 * so tokens issued before a rotation still verify until they expire.
 */
@Injectable()
export class SignedUrlGeneratorService {
  private readonly logger = new Logger(SignedUrlGeneratorService.name);
  private readonly activeKeyId: string;
  private readonly signingSecret: string;
  private readonly verificationKeys: Map<string, string>;
  private readonly defaultExpiryMinutes: number;

  constructor(private readonly configService: ConfigService) {
    this.activeKeyId = this.configService.get('SIGNED_URL_KEY_ID', 'default');
    this.signingSecret = this.configService.get('SIGNED_URL_SECRET', 'default-signing-secret');
    this.defaultExpiryMinutes = this.configService.get('SIGNED_URL_EXPIRY_MINUTES', 60);

    this.verificationKeys = new Map([[this.activeKeyId, this.signingSecret]]);
    const rotatedKeys = this.configService.get<string>('SIGNED_URL_ROTATED_KEYS');
    if (rotatedKeys) {
      for (const [keyId, secret] of Object.entries(JSON.parse(rotatedKeys) as Record<string, string>)) {
        this.verificationKeys.set(keyId, secret);
      }
    }

    if (this.signingSecret === 'default-signing-secret') {
      this.logger.warn(
        'Using default signing secret for signed URLs. Set SIGNED_URL_SECRET in production.',
      );
    }
  }

  /**
   * Generates a signed URL for downloading an export file.
   *
   * @param exportId Unique identifier for this export
   * @param exportType Type of export (e.g., 'tax-report', 'user-data')
   * @param userId The user requesting the export
   * @param filePath Path to the file on disk
   * @param format File format (e.g., 'json', 'csv', 'pdf')
   * @param expiryMinutes Optional custom expiry time in minutes (defaults to config)
   * @returns A signed URL token that can be used to download the file
   */
  generateSignedUrl(
    exportId: string,
    exportType: string,
    userId: string,
    filePath: string,
    format: string,
    expiryMinutes?: number,
  ): string {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + (expiryMinutes ?? this.defaultExpiryMinutes) * 60;

    const fields: SignedFields = {
      keyId: this.activeKeyId,
      exportId,
      exportType,
      userId,
      filePath,
      format,
      issuedAt,
      expiresAt,
    };

    const payload: SignedUrlPayload = {
      ...fields,
      signature: this.computeSignature(fields, this.signingSecret),
    };

    return Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64');
  }

  /**
   * Validates a signed URL and returns the decoded payload if valid.
   *
   * @param signedUrl The signed URL token
   * @returns The decoded payload if valid
   * @throws {Error} If the URL is invalid, expired, or tampered with
   */
  validateAndDecodeSignedUrl(signedUrl: string): SignedUrlPayload {
    // Decode from base64
    let decoded: string;
    try {
      decoded = Buffer.from(signedUrl, 'base64').toString('utf-8');
    } catch (error) {
      throw new Error('Invalid signed URL format — failed to decode base64');
    }

    // Parse JSON
    let payload: SignedUrlPayload;
    try {
      payload = JSON.parse(decoded);
    } catch (error) {
      throw new Error('Invalid signed URL payload — malformed JSON');
    }

    // Validate structure
    if (
      !payload.keyId ||
      !payload.exportId ||
      !payload.exportType ||
      !payload.userId ||
      !payload.filePath ||
      !payload.format ||
      typeof payload.issuedAt !== 'number' ||
      typeof payload.expiresAt !== 'number' ||
      !payload.signature
    ) {
      throw new Error('Invalid signed URL payload — missing required fields');
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (now > payload.expiresAt) {
      throw new Error(`Signed URL has expired (expired at ${new Date(payload.expiresAt * 1000).toISOString()})`);
    }

    // Verify signature with the key the token names (active or rotated-out)
    const secret = this.verificationKeys.get(payload.keyId);
    if (!secret) {
      throw new Error(`Signed URL signature verification failed — unknown key id "${payload.keyId}"`);
    }

    const expectedSignature = this.computeSignature(payload, secret);

    if (!this.constantTimeEquals(payload.signature, expectedSignature)) {
      throw new Error('Signed URL signature verification failed — URL may have been tampered with');
    }

    return payload;
  }

  /**
   * Computes the HMAC-SHA256 signature over every signed field.
   * Fields are picked explicitly so extra properties in a token are never signed or trusted.
   *
   * @returns The hex-encoded signature
   */
  private computeSignature(fields: SignedFields, secret: string): string {
    const data = JSON.stringify([
      fields.keyId,
      fields.exportId,
      fields.exportType,
      fields.userId,
      fields.filePath,
      fields.format,
      fields.issuedAt,
      fields.expiresAt,
    ]);
    return crypto.createHmac('sha256', secret).update(data).digest('hex');
  }

  /**
   * Compares two strings in constant time to prevent timing attacks.
   *
   * @param a First string
   * @param b Second string
   * @returns true if strings are equal, false otherwise
   */
  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }

    return result === 0;
  }
}
