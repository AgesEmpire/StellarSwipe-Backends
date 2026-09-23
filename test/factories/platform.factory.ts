import { faker } from '@faker-js/faker';

export interface TestPlatformState {
  adminPublicKey: string;
  platformFeeBps: number;
  sessionCounter: number;
  maxSessionDurationSeconds: number;
}

export interface TestSignalProvider {
  id: string;
  userId: string;
  displayName: string;
  winRate: number;
  totalSignals: number;
  isActive: boolean;
}

/**
 * PlatformFactory — generates test platform configuration and entities.
 */
export class PlatformFactory {
  /**
   * Build a test platform state object.
   */
  buildPlatformState(overrides: Partial<TestPlatformState> = {}): TestPlatformState {
    return {
      adminPublicKey:
        overrides.adminPublicKey ?? `G${faker.string.alphanumeric(55).toUpperCase()}`,
      platformFeeBps: overrides.platformFeeBps ?? 250,
      sessionCounter: overrides.sessionCounter ?? 0,
      maxSessionDurationSeconds: overrides.maxSessionDurationSeconds ?? 7 * 24 * 60 * 60,
    };
  }

  /**
   * Build a test signal provider.
   */
  buildSignalProvider(overrides: Partial<TestSignalProvider> = {}): TestSignalProvider {
    return {
      id: overrides.id ?? faker.string.uuid(),
      userId: overrides.userId ?? faker.string.uuid(),
      displayName: overrides.displayName ?? faker.person.fullName(),
      winRate: overrides.winRate ?? faker.number.float({ min: 0.3, max: 0.95, fractionDigits: 2 }),
      totalSignals: overrides.totalSignals ?? faker.number.int({ min: 10, max: 1000 }),
      isActive: overrides.isActive ?? true,
    };
  }
}
