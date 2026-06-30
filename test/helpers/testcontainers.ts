/**
 * Testcontainers helpers for integration tests.
 *
 * Spins up isolated Postgres and Redis containers per test-run so tests
 * always execute against real database/cache behaviour, regardless of the
 * host environment. Containers are torn down cleanly on completion, including
 * on failure.
 *
 * Usage:
 *   import { startContainers, stopContainers, ContainerHandles } from './testcontainers';
 *
 *   let containers: ContainerHandles;
 *
 *   beforeAll(async () => { containers = await startContainers(); });
 *   afterAll(async ()  => { await stopContainers(containers); });
 */

import {
  GenericContainer,
  StartedTestContainer,
  Wait,
} from 'testcontainers';
import { DataSource } from 'typeorm';
import * as path from 'path';

export interface ContainerHandles {
  postgres: StartedTestContainer;
  redis: StartedTestContainer;
  dataSource: DataSource;
}

const POSTGRES_IMAGE = 'postgres:15-alpine';
const REDIS_IMAGE = 'redis:7-alpine';

const POSTGRES_USER = 'test';
const POSTGRES_PASSWORD = 'test';
const POSTGRES_DB = 'stellarswipe_test';

/**
 * Start Postgres and Redis containers, run TypeORM migrations against
 * the Postgres container, and expose connection details via env variables
 * so NestJS ConfigService / TypeORM config picks them up.
 */
export async function startContainers(): Promise<ContainerHandles> {
  // ── Postgres ──────────────────────────────────────────────────────────────
  const postgres = await new GenericContainer(POSTGRES_IMAGE)
    .withEnvironment({
      POSTGRES_USER,
      POSTGRES_PASSWORD,
      POSTGRES_DB,
    })
    .withExposedPorts(5432)
    .withWaitStrategy(
      Wait.forLogMessage(/database system is ready to accept connections/),
    )
    .start();

  const pgHost = postgres.getHost();
  const pgPort = postgres.getMappedPort(5432);

  // ── Redis ─────────────────────────────────────────────────────────────────
  const redis = await new GenericContainer(REDIS_IMAGE)
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage(/Ready to accept connections/))
    .start();

  const redisHost = redis.getHost();
  const redisPort = redis.getMappedPort(6379);

  // Expose to NestJS / TypeORM config via process.env
  process.env.TEST_DATABASE_HOST = pgHost;
  process.env.TEST_DATABASE_PORT = String(pgPort);
  process.env.TEST_DATABASE_USER = POSTGRES_USER;
  process.env.TEST_DATABASE_PASSWORD = POSTGRES_PASSWORD;
  process.env.TEST_DATABASE_NAME = POSTGRES_DB;
  process.env.REDIS_HOST = redisHost;
  process.env.REDIS_PORT = String(redisPort);

  // ── Migrations ────────────────────────────────────────────────────────────
  const dataSource = new DataSource({
    type: 'postgres',
    host: pgHost,
    port: pgPort,
    username: POSTGRES_USER,
    password: POSTGRES_PASSWORD,
    database: POSTGRES_DB,
    entities: [path.resolve(__dirname, '../../src/**/*.entity.ts')],
    migrations: [path.resolve(__dirname, '../../src/migrations/**/*.ts')],
    migrationsRun: false,
    synchronize: true, // use sync in tests; production uses real migrations
    logging: false,
  });

  await dataSource.initialize();

  return { postgres, redis, dataSource };
}

/**
 * Cleanly tear down both containers and close the DataSource.
 * Safe to call even if startContainers() threw partway through
 * (handles may be undefined or partially initialised).
 */
export async function stopContainers(handles?: Partial<ContainerHandles>): Promise<void> {
  if (!handles) return;
  if (handles.dataSource?.isInitialized) {
    await handles.dataSource.destroy().catch(() => undefined);
  }
  await handles.postgres?.stop().catch(() => undefined);
  await handles.redis?.stop().catch(() => undefined);
}

/**
 * Returns true when a Docker socket is reachable so tests can skip
 * gracefully in environments without Docker (e.g. some local CI runners).
 */
export async function isDockerAvailable(): Promise<boolean> {
  try {
    // Testcontainers performs its own Docker socket check on first container
    // creation. We rely on the same underlying mechanism: if the DOCKER_HOST
    // env is explicitly set to a non-default value we trust it; otherwise we
    // attempt a lightweight Node socket check.
    const { createConnection } = await import('net');
    const socketPath = process.env.DOCKER_HOST?.replace('unix://', '') ?? '/var/run/docker.sock';
    return await new Promise((resolve) => {
      const socket = createConnection(socketPath);
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => { socket.destroy(); resolve(false); });
    });
  } catch {
    return false;
  }
}
