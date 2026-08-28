/**
 * Types for the credential rotation system.
 */

/** Credential types that support rotation. */
export type CredentialType =
  | 'database'
  | 'jwt'
  | 'signing-key'
  | 'api-key'
  | 'encryption-key'
  | 'provider-token';

/** Configuration for how a credential rotation should be performed. */
export interface RotationPolicy {
  /** Unique name identifying the credential (e.g. 'database.password'). */
  name: string;
  /** What kind of credential this is. */
  type: CredentialType;
  /** Duration in ms during which both old and new credentials are accepted. */
  overlapWindowMs: number;
  /** Auto-rotation interval in ms.  0 = manual only. */
  autoRotateIntervalMs: number;
  /** Maximum number of previous credentials to retain for overlap validation. */
  maxPreviousCredentials: number;
}

/** Tracks a credential and its overlap state during rotation. */
export interface CredentialState {
  /** The currently active credential value. */
  current: string;
  /** Previous credentials still within their overlap window. */
  previous: { value: string; expiresAt: number }[];
  /** ISO-8601 timestamp of the last rotation. */
  lastRotatedAt: string;
  /** The policy governing this credential. */
  policy: RotationPolicy;
}

/** Payload emitted when a rotation lifecycle event occurs. */
export interface RotationEventPayload {
  /** Name of the secret being rotated. */
  secretName: string;
  /** Phase of the rotation lifecycle. */
  phase: 'started' | 'overlap-active' | 'overlap-expired' | 'completed' | 'failed';
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Human-readable detail (never contains secret values). */
  detail?: string;
}

/** Default policies for well-known credentials. */
export const DEFAULT_ROTATION_POLICIES: Record<string, Partial<RotationPolicy>> = {
  'database.password': {
    type: 'database',
    overlapWindowMs: 5 * 60 * 1000, // 5 minutes
    maxPreviousCredentials: 1,
  },
  'jwt.secret': {
    type: 'jwt',
    overlapWindowMs: 30 * 60 * 1000, // 30 minutes — allow existing tokens to validate
    maxPreviousCredentials: 2,
  },
  'encryption.key': {
    type: 'encryption-key',
    overlapWindowMs: 60 * 60 * 1000, // 1 hour — allow decrypt with old key
    maxPreviousCredentials: 3,
  },
  'stellar.secret_key': {
    type: 'signing-key',
    overlapWindowMs: 2 * 60 * 1000, // 2 minutes
    maxPreviousCredentials: 1,
  },
};
