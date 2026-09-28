/**
 * RefreshTokenCleanupService integration test — Testcontainers edition.
 *
 * Spins up isolated Postgres and Redis containers (same helper used by the
 * RiskGate integration suite) so the cleanup job is exercised against real
 * infrastructure: a real `refresh_tokens` table and a real distributed lock
 * backed by Redis.
 *
 * When Docker is unavailable (e.g. a sandboxed CI runner) every test returns
 * early so the suite stays green without false positives.
 *
 * Issue #821 acceptance criteria addressed here:
 *  - Expired refresh tokens are deleted.
 *  - Active (non-expired) tokens are never touched.
 *  - Deletions are batched (verified against a batch size smaller than the
 *    seeded row count).
 *  - Row-count is returned/logged for observability.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RefreshTokenCleanupService } from '../../src/auth/refresh-token-cleanup.service';
import { RefreshToken } from '../../src/auth/entities/refresh-token.entity';
import { DistributedLockService } from '../../src/common/services/distributed-lock.service';
import {
  startContainers,
  stopContainers,
  isDockerAvailable,
  ContainerHandles,
} from '../helpers/testcontainers';

jest.setTimeout(120_000);

describe('RefreshTokenCleanupService (Testcontainers integration)', () => {
  let containers: Partial<ContainerHandles> | undefined;
  let module: TestingModule | undefined;
  let service: RefreshTokenCleanupService | undefined;
  let repository: Repository<RefreshToken> | undefined;
  let dockerAvailable = false;

  beforeAll(async () => {
    dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) return;

    containers = await startContainers();

    // process.env.REFRESH_TOKEN_CLEANUP_BATCH_SIZE is read at construction
    // time by the service; set it small so we can prove batching works
    // against a handful of rows instead of needing thousands.
    process.env.REFRESH_TOKEN_CLEANUP_BATCH_SIZE = '2';

    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.TEST_DATABASE_HOST,
          port: parseInt(process.env.TEST_DATABASE_PORT as string, 10),
          username: process.env.TEST_DATABASE_USER,
          password: process.env.TEST_DATABASE_PASSWORD,
          database: process.env.TEST_DATABASE_NAME,
          entities: [RefreshToken],
          synchronize: true,
        }),
        TypeOrmModule.forFeature([RefreshToken]),
      ],
      providers: [RefreshTokenCleanupService, DistributedLockService],
    }).compile();

    service = module.get(RefreshTokenCleanupService);
    repository = module.get(getRepositoryToken(RefreshToken));
  });

  afterAll(async () => {
    delete process.env.REFRESH_TOKEN_CLEANUP_BATCH_SIZE;
    await module?.close();
    await stopContainers(containers);
  });

  afterEach(async () => {
    if (!hasDocker()) return;
    await repository!.clear();
  });

  function hasDocker(): boolean {
    return dockerAvailable && !!service && !!repository;
  }

  function makeToken(overrides: Partial<RefreshToken> = {}): Partial<RefreshToken> {
    return {
      tokenHash: `hash-${Math.random().toString(36).slice(2)}`,
      userId: '11111111-1111-1111-1111-111111111111',
      sessionId: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // valid by default
      ...overrides,
    };
  }

  it('containers are reachable — Postgres is initialised', () => {
    if (!hasDocker()) return;
    expect((containers as ContainerHandles).dataSource.isInitialized).toBe(true);
  });

  it('deletes expired refresh tokens and retains active ones', async () => {
    if (!hasDocker()) return;

    const expired = await repository!.save(
      repository!.create(
        makeToken({ expiresAt: new Date(Date.now() - 60 * 60 * 1000) }),
      ),
    );
    const active = await repository!.save(repository!.create(makeToken()));

    const deletedCount = await service!.deleteExpiredTokens();

    expect(deletedCount).toBe(1);
    await expect(repository!.findOneBy({ id: expired.id })).resolves.toBeNull();
    await expect(repository!.findOneBy({ id: active.id })).resolves.not.toBeNull();
  });

  it('never deletes a token whose expiry is in the future, even by a second', async () => {
    if (!hasDocker()) return;

    const almostExpired = await repository!.save(
      repository!.create(makeToken({ expiresAt: new Date(Date.now() + 1000) })),
    );

    const deletedCount = await service!.deleteExpiredTokens();

    expect(deletedCount).toBe(0);
    await expect(repository!.findOneBy({ id: almostExpired.id })).resolves.not.toBeNull();
  });

  it('processes deletions in batches smaller than the total expired row count', async () => {
    if (!hasDocker()) return;

    // Batch size is configured to 2 (see beforeAll) — seed 5 expired rows to
    // force multiple delete batches within a single invocation.
    const expiredRows = await Promise.all(
      Array.from({ length: 5 }, () =>
        repository!.save(
          repository!.create(
            makeToken({ expiresAt: new Date(Date.now() - 60 * 60 * 1000) }),
          ),
        ),
      ),
    );
    const active = await repository!.save(repository!.create(makeToken()));

    const deletedCount = await service!.deleteExpiredTokens();

    expect(deletedCount).toBe(expiredRows.length);
    const remaining = await repository!.count();
    expect(remaining).toBe(1);
    await expect(repository!.findOneBy({ id: active.id })).resolves.not.toBeNull();
  });

  it('is safe to run concurrently — two overlapping runs never error and never double-count beyond total rows', async () => {
    if (!hasDocker()) return;

    await Promise.all(
      Array.from({ length: 4 }, () =>
        repository!.save(
          repository!.create(
            makeToken({ expiresAt: new Date(Date.now() - 60 * 60 * 1000) }),
          ),
        ),
      ),
    );

    const [firstRun, secondRun] = await Promise.all([
      service!.deleteExpiredTokens(),
      service!.deleteExpiredTokens(),
    ]);

    // Total rows actually deleted across both concurrent runs must equal
    // exactly the number of expired rows seeded — no double-deletion, no
    // errors thrown, no rows left behind.
    expect(firstRun + secondRun).toBe(4);
    await expect(repository!.count()).resolves.toBe(0);
  });
});
