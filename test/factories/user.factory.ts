import { faker } from '@faker-js/faker';

export interface TestUser {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
  stellarPublicKey: string;
  isVerified: boolean;
  createdAt: Date;
}

export interface CreateUserOptions {
  email?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  isVerified?: boolean;
  stellarPublicKey?: string;
}

/**
 * UserFactory — generates deterministic test user data.
 *
 * Uses @faker-js/faker for realistic data while keeping tests reproducible
 * by accepting optional overrides.
 */
export class UserFactory {
  private counter = 0;

  /**
   * Build a test user object (does not persist to DB).
   */
  build(overrides: CreateUserOptions = {}): TestUser {
    this.counter++;
    return {
      id: faker.string.uuid(),
      email: overrides.email ?? faker.internet.email().toLowerCase(),
      username: overrides.username ?? `testuser_${this.counter}_${faker.string.alphanumeric(6)}`,
      firstName: overrides.firstName ?? faker.person.firstName(),
      lastName: overrides.lastName ?? faker.person.lastName(),
      passwordHash: '$2b$10$fakehashforintegrationtests000000000000000000',
      stellarPublicKey:
        overrides.stellarPublicKey ??
        `G${faker.string.alphanumeric(55).toUpperCase()}`,
      isVerified: overrides.isVerified ?? true,
      createdAt: new Date(),
    };
  }

  /**
   * Build multiple test users.
   */
  buildMany(count: number, overrides: CreateUserOptions = {}): TestUser[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }
}
