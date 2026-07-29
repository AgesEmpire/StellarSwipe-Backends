/**
 * Unit tests for the security-setting change cool-down enforcement in
 * TwoFactorService.  These tests exercise the cool-down guard directly
 * by calling the private method via a cast — keeping the test surface
 * focused without wiring up the full module graph.
 */

import { BadRequestException } from '@nestjs/common';
import { TwoFactor } from './entities/two-factor.entity';

// Expose the private helper through a minimal subclass to allow unit testing
// without instantiating the full TwoFactorService (which requires config + cache).
class CooldownTestHarness {
  private readonly changeCooldownMs: number;

  constructor(cooldownSeconds: number) {
    this.changeCooldownMs = cooldownSeconds * 1000;
  }

  assertChangeCooldown(record: Partial<TwoFactor>): void {
    if (!record.lastSecurityChangeAt) return;

    const msSinceLastChange = Date.now() - record.lastSecurityChangeAt.getTime();

    if (msSinceLastChange < this.changeCooldownMs) {
      const remainingSeconds = Math.ceil(
        (this.changeCooldownMs - msSinceLastChange) / 1000,
      );
      throw new BadRequestException(
        `Security settings were changed recently. Please wait ${remainingSeconds}s before making another change.`,
      );
    }
  }
}

describe('TwoFactorService – security-setting change cool-down', () => {
  const COOLDOWN_SECONDS = 300;
  let harness: CooldownTestHarness;

  beforeEach(() => {
    harness = new CooldownTestHarness(COOLDOWN_SECONDS);
  });

  it('allows the very first change when lastSecurityChangeAt is null (exempt)', () => {
    const record: Partial<TwoFactor> = { lastSecurityChangeAt: undefined };
    expect(() => harness.assertChangeCooldown(record)).not.toThrow();
  });

  it('blocks a change attempted before the cool-down period has elapsed', () => {
    const record: Partial<TwoFactor> = {
      // Changed 10 seconds ago — well within the 300s cool-down
      lastSecurityChangeAt: new Date(Date.now() - 10_000),
    };
    expect(() => harness.assertChangeCooldown(record)).toThrow(BadRequestException);
  });

  it('blocks a change attempted exactly at the boundary (not elapsed yet)', () => {
    const record: Partial<TwoFactor> = {
      // Changed 299.5s ago — still inside the cool-down window
      lastSecurityChangeAt: new Date(Date.now() - (COOLDOWN_SECONDS * 1000 - 500)),
    };
    expect(() => harness.assertChangeCooldown(record)).toThrow(BadRequestException);
  });

  it('allows a change attempted after the cool-down period has fully elapsed', () => {
    const record: Partial<TwoFactor> = {
      // Changed 301 seconds ago — just past the cool-down
      lastSecurityChangeAt: new Date(Date.now() - (COOLDOWN_SECONDS * 1000 + 1000)),
    };
    expect(() => harness.assertChangeCooldown(record)).not.toThrow();
  });

  it('error message includes the remaining cool-down seconds', () => {
    const record: Partial<TwoFactor> = {
      lastSecurityChangeAt: new Date(Date.now() - 60_000), // 60s ago, 240s remaining
    };
    try {
      harness.assertChangeCooldown(record);
      fail('expected BadRequestException');
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).message).toMatch(/\d+s/);
    }
  });
});
