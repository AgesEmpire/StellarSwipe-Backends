import * as crypto from 'crypto';

export interface MfaChallenge {
  challengeId: string;
  code: string;
  expiresAt: Date;
}

export function generateMfaChallenge(): MfaChallenge {
  const code = crypto.randomInt(100000, 999999).toString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
  return { challengeId: crypto.randomUUID(), code, expiresAt };
}

export function isChallengeExpired(expiresAt: Date): boolean {
  return new Date() > expiresAt;
}
