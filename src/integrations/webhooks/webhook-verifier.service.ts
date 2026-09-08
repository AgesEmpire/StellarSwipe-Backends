import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { DistributedLockService } from '../../common/services/distributed-lock.service';
import { PrometheusService } from '../../monitoring/metrics/prometheus.service';
import {
  HmacAlgorithm,
  parseSignatureHeader,
  verifyRotatingHmacSignature,
} from './utils/signature-validator';

export interface WebhookVerificationOptions {
  rawBody: Buffer | string | undefined;
  parsedBody?: unknown;
  signatureHeader?: string;
  /** Env var holding the signing secret(s) for this provider. Comma-separate to support rotation, e.g. "newSecret,oldSecret". */
  providerKeyName?: string;
  algorithm?: HmacAlgorithm;
  /** Short label used for logs, metrics, and replay-dedupe scoping. Defaults to `providerKeyName`. */
  provider?: string;
  /** Clock-skew tolerance, in seconds, for timestamped signature formats (`t=..,v1=..`). Default 300 (5 min). */
  toleranceSeconds?: number;
  /** How long a given signature is remembered to reject exact replays, in seconds. Default max(2 * toleranceSeconds, 600). */
  replayWindowSeconds?: number;
  /** Disable replay-nonce dedupe for this call (e.g. a provider with its own durable idempotency store). Default true (enabled). */
  enableReplayProtection?: boolean;
}

const DEFAULT_TOLERANCE_SECONDS = 300;
const DEFAULT_MIN_REPLAY_WINDOW_SECONDS = 600;
const REPLAY_LOCK_PREFIX = 'webhook-replay';

/**
 * Verifies signatures on *incoming* webhooks (Persona, Onfido, M-Pesa,
 * Paystack, Zapier/Make, our own inbound automation callbacks, …) before any
 * business logic runs.
 *
 * Three properties are enforced, in order, so failures are cheap and the
 * reason is unambiguous from the exception type / log line:
 *
 *   1. Malformed payload  → 400 BadRequestException  (no body captured)
 *   2. Bad/rotated-out signature or stale timestamp → 401 UnauthorizedException
 *   3. Exact-duplicate delivery (replay)  → 409 ConflictException
 *
 * Rotation: `providerKeyName` may resolve to a comma-separated list of
 * secrets, e.g. `WEBHOOK_SIGNING_KEY=<new>,<old>`. Every secret in the list
 * is tried; a match on anything but the first is logged as a warning so
 * operators know when it's safe to drop the retired secret.
 *
 * Replay protection: for timestamped signature formats we first reject
 * anything outside the clock-skew tolerance window. Independent of that, we
 * also remember the fingerprint of every *verified* signature for
 * `replayWindowSeconds` via a Redis-backed distributed lock (atomic
 * `SET NX`), so an exact replay of a previously-accepted request — with or
 * without a timestamp — is rejected even from a different app instance.
 *
 * If the replay store is unreachable (e.g. Redis outage) we log a warning
 * and fail OPEN rather than reject every webhook in the system: the request
 * has already passed signature verification, and provider-specific,
 * durable idempotency (see `WebhookIdempotencyService`) remains as a second
 * line of defense against duplicate side effects.
 */
@Injectable()
export class WebhookVerifierService {
  private readonly logger = new Logger(WebhookVerifierService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly distributedLock: DistributedLockService,
    @Optional() private readonly prometheus?: PrometheusService,
  ) {}

  /**
   * Verifies a raw body against a signature header, trying every secret
   * configured for `providerKeyName` (supports rotation). Throws
   * `UnauthorizedException` on any failure. Does not check timestamps or
   * replay — use `validateRequest` for the full pipeline.
   */
  validate(
    rawBody: string,
    signatureHeader?: string,
    providerKeyName = 'WEBHOOK_SIGNING_KEY',
    algorithm: HmacAlgorithm = 'sha256',
  ): boolean {
    if (!signatureHeader || !parseSignatureHeader(signatureHeader)) {
      this.logger.warn(`Missing or malformed webhook signature header for ${providerKeyName}`);
      this.recordOutcome(providerKeyName, 'missing_signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const secrets = this.getSecrets(providerKeyName);
    if (secrets.length === 0) {
      this.logger.error(`No signing secret configured for ${providerKeyName} — refusing to verify`);
      this.recordOutcome(providerKeyName, 'misconfigured');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const result = verifyRotatingHmacSignature(rawBody, signatureHeader, secrets, algorithm);

    if (!result.valid) {
      this.logger.warn(`Invalid webhook signature for ${providerKeyName}`);
      this.recordOutcome(providerKeyName, 'invalid_signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (result.matchedSecretIndex > 0) {
      this.logger.warn(
        `Webhook for ${providerKeyName} verified against a rotated-out secret (index ${result.matchedSecretIndex}). ` +
          'Confirm the sender has switched to the current secret before removing the old one.',
      );
    }
    this.recordSecretIndex(providerKeyName, result.matchedSecretIndex);
    this.recordOutcome(providerKeyName, 'signature_valid');

    return true;
  }

  /**
   * Full verification pipeline for a controller handling an inbound
   * webhook: malformed-payload guard → rotation-aware signature check →
   * timestamp tolerance (if applicable) → replay dedupe.
   *
   * Returns the raw body string so callers can re-parse it if needed
   * without trusting `parsedBody` (which may have been mutated by
   * middleware).
   */
  async validateRequest(options: WebhookVerificationOptions): Promise<string> {
    const provider = options.provider || options.providerKeyName || 'unknown-provider';
    const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;

    if (this.isEffectivelyEmptyBody(options.rawBody, options.parsedBody)) {
      this.logger.warn(`Rejected webhook for ${provider}: empty or missing payload`);
      this.recordOutcome(provider, 'malformed_payload');
      throw new BadRequestException('Missing or empty webhook payload');
    }

    const rawBody = this.getRawBody(options.rawBody, options.parsedBody);

    // 1 & 2: malformed signature / bad signature / rotated-out secret.
    this.validate(rawBody, options.signatureHeader, options.providerKeyName, options.algorithm);

    // 3: timestamp tolerance, for signature formats that carry one.
    const parsed = parseSignatureHeader(options.signatureHeader);
    if (parsed?.timestamp !== undefined) {
      const skewSeconds = Math.abs(Date.now() / 1000 - parsed.timestamp);
      if (skewSeconds > toleranceSeconds) {
        this.logger.warn(
          `Rejected webhook for ${provider}: timestamp outside ${toleranceSeconds}s tolerance (skew=${Math.round(skewSeconds)}s)`,
        );
        this.recordOutcome(provider, 'stale_timestamp');
        throw new UnauthorizedException('Webhook timestamp outside tolerance window');
      }
    }

    // 4: replay dedupe — only for requests that already proved authenticity above.
    if (options.enableReplayProtection !== false) {
      const replayWindowSeconds =
        options.replayWindowSeconds ?? Math.max(toleranceSeconds * 2, DEFAULT_MIN_REPLAY_WINDOW_SECONDS);
      await this.assertNotReplayed(provider, options.signatureHeader as string, replayWindowSeconds);
    }

    this.recordOutcome(provider, 'accepted');
    return rawBody;
  }

  /** Resolves the ordered list of currently-valid secrets for a provider key. Comma-separate to support rotation. */
  private getSecrets(providerKeyName: string): string[] {
    const raw =
      this.config.get<string>(providerKeyName) || this.config.get<string>('WEBHOOK_SIGNING_KEY') || '';
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private isEffectivelyEmptyBody(rawBody: Buffer | string | undefined, parsedBody?: unknown): boolean {
    if (Buffer.isBuffer(rawBody)) return rawBody.length === 0;
    if (typeof rawBody === 'string') return rawBody.trim().length === 0;
    // No raw body captured (rawBody:true not enabled on this route) — fall
    // back to whether a parsed body was supplied at all.
    return rawBody === undefined && (parsedBody === undefined || parsedBody === null);
  }

  private async assertNotReplayed(provider: string, signatureHeader: string, windowSeconds: number): Promise<void> {
    const fingerprint = crypto.createHash('sha256').update(signatureHeader).digest('hex');
    const key = `${REPLAY_LOCK_PREFIX}:${provider}:${fingerprint}`;

    try {
      const token = await this.distributedLock.acquire(key, windowSeconds * 1000);
      if (!token) {
        this.logger.warn(`Rejected webhook for ${provider}: duplicate delivery detected (possible replay)`);
        this.recordOutcome(provider, 'replayed');
        throw new ConflictException('Duplicate webhook delivery detected');
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      // Replay store unreachable — fail open. The request already passed
      // signature verification; provider-level idempotency (durable, DB
      // backed) remains as a second line of defense.
      this.logger.warn(
        `Replay check unavailable for ${provider}, allowing request through: ${(error as Error).message}`,
      );
      this.recordOutcome(provider, 'replay_check_unavailable');
    }
  }

  private recordOutcome(provider: string, result: string): void {
    this.prometheus?.webhookVerificationTotal?.inc({ provider, result });
  }

  private recordSecretIndex(provider: string, index: number): void {
    this.prometheus?.webhookSecretIndexUsed?.inc({ provider, secret_index: String(index) });
  }

  private getRawBody(rawBody: Buffer | string | undefined, parsedBody?: unknown): string {
    if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
    if (typeof rawBody === 'string') return rawBody;
    return JSON.stringify(parsedBody ?? {});
  }
}
