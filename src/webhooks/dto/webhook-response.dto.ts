import { Webhook } from '../entities/webhook.entity';
import { maskSecret } from '../utils/secret-masking.util';

export interface SecretRevealOptions {
  /** Return the current secret in plain text (creation only). */
  secret?: boolean;
  /** Return the pending rotation secret in plain text (rotation initiation only). */
  nextSecret?: boolean;
}

/**
 * Serializes a webhook for API responses. Stored secrets are masked unless
 * explicitly revealed for the one response that hands them to the owner.
 */
export function toWebhookResponse(
  webhook: Webhook,
  reveal: SecretRevealOptions = {},
): Webhook {
  const { secret, nextSecret, ...rest } = webhook;
  return {
    ...rest,
    secret: reveal.secret ? secret : maskSecret(secret),
    nextSecret:
      nextSecret && !reveal.nextSecret ? maskSecret(nextSecret) : nextSecret,
  };
}
