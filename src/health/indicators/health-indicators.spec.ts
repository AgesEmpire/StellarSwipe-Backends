import { HealthCheckError } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health';
import { RedisHealthIndicator } from './redis.health';
import { StellarHealthIndicator } from './stellar.health';
import { SorobanHealthIndicator } from './soroban.health';

// ── DatabaseHealthIndicator ───────────────────────────────────────────────────

describe('DatabaseHealthIndicator', () => {
  const makeIndicator = (overrides: Partial<{ isInitialized: boolean; query: jest.Mock }> = {}) => {
    const dataSource = {
      isInitialized: overrides.isInitialized ?? true,
      query: overrides.query ?? jest.fn().mockResolvedValue([{ health_check: 1 }]),
    } as any;
    return new DatabaseHealthIndicator(dataSource);
  };

  it('returns up when DB is connected and query succeeds', async () => {
    const result = await makeIndicator().isHealthy('database');
    expect(result.database.status).toBe('up');
  });

  it('includes type, connected flag, and latency in the up result', async () => {
    const result = await makeIndicator().isHealthy('database');
    expect(result.database).toMatchObject({ type: 'postgres', connected: true });
    expect(result.database.latency).toMatch(/\d+ms/);
  });

  it('throws HealthCheckError when dataSource is not initialized', async () => {
    await expect(makeIndicator({ isInitialized: false }).isHealthy('database'))
      .rejects.toBeInstanceOf(HealthCheckError);
  });

  it('throws HealthCheckError when query fails', async () => {
    await expect(
      makeIndicator({ query: jest.fn().mockRejectedValue(new Error('connection refused')) })
        .isHealthy('database'),
    ).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('includes error message in the down result', async () => {
    try {
      await makeIndicator({ query: jest.fn().mockRejectedValue(new Error('timeout')) })
        .isHealthy('database');
    } catch (err) {
      expect((err as HealthCheckError).causes).toMatchObject({
        database: { status: 'down', error: 'timeout' },
      });
    }
  });
});

// ── RedisHealthIndicator ──────────────────────────────────────────────────────

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    ping: jest.fn(),
    info: jest.fn(),
    disconnect: jest.fn(),
  }));
});

import Redis from 'ioredis';

const getRedisMock = () =>
  (Redis as unknown as jest.Mock).mock.results.at(-1)!.value as {
    connect: jest.Mock;
    ping: jest.Mock;
    info: jest.Mock;
    disconnect: jest.Mock;
  };

describe('RedisHealthIndicator', () => {
  const makeIndicator = () => {
    const configService = {
      get: jest.fn().mockImplementation((key: string) => {
        const map: Record<string, any> = {
          'redis.host': 'localhost',
          'redis.port': 6379,
          'redis.password': undefined,
          'redis.db': 0,
        };
        return map[key];
      }),
    } as any;
    return new RedisHealthIndicator(configService);
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns up when Redis responds to PING', async () => {
    const indicator = makeIndicator();
    const mock = getRedisMock();
    mock.connect.mockResolvedValue(undefined);
    mock.ping.mockResolvedValue('PONG');
    mock.info.mockResolvedValue('redis_version:7.0.0\r\n');
    mock.disconnect.mockResolvedValue(undefined);

    const result = await indicator.isHealthy('cache');
    // The indicator passes status:'connected' in details which overrides terminus's 'up'
    expect(result.cache.status).toBe('connected');
  });

  it('includes version and latency in the up result', async () => {
    const indicator = makeIndicator();
    const mock = getRedisMock();
    mock.connect.mockResolvedValue(undefined);
    mock.ping.mockResolvedValue('PONG');
    mock.info.mockResolvedValue('redis_version:7.2.1\r\n');
    mock.disconnect.mockResolvedValue(undefined);

    const result = await indicator.isHealthy('cache');
    expect(result.cache.version).toBe('7.2.1');
    expect(result.cache.latency).toMatch(/\d+ms/);
  });

  it('throws HealthCheckError when connect fails', async () => {
    const indicator = makeIndicator();
    const mock = getRedisMock();
    mock.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    mock.disconnect.mockResolvedValue(undefined);

    await expect(indicator.isHealthy('cache')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('throws HealthCheckError when ping fails', async () => {
    const indicator = makeIndicator();
    const mock = getRedisMock();
    mock.connect.mockResolvedValue(undefined);
    mock.ping.mockRejectedValue(new Error('ping timeout'));
    mock.disconnect.mockResolvedValue(undefined);

    await expect(indicator.isHealthy('cache')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('includes error message in the down result', async () => {
    const indicator = makeIndicator();
    const mock = getRedisMock();
    mock.connect.mockRejectedValue(new Error('ECONNREFUSED'));
    mock.disconnect.mockResolvedValue(undefined);

    try {
      await indicator.isHealthy('cache');
    } catch (err) {
      // The indicator uses status:'disconnected' in the details object
      expect((err as HealthCheckError).causes).toMatchObject({
        cache: { error: 'ECONNREFUSED' },
      });
    }
  });
});

// ── StellarHealthIndicator ────────────────────────────────────────────────────

const mockLedgersCall = jest.fn();
const mockLedgersChain = { limit: jest.fn().mockReturnValue({ call: mockLedgersCall }) };
const mockLedgersOrder = jest.fn().mockReturnValue(mockLedgersChain);
const mockLedgers = jest.fn().mockReturnValue({ order: mockLedgersOrder });

jest.mock('@stellar/stellar-sdk', () => ({
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      ledgers: mockLedgers,
    })),
  },
  SorobanRpc: {
    Server: jest.fn().mockImplementation(() => ({
      getHealth: jest.fn(),
    })),
  },
}));

import * as StellarSdk from '@stellar/stellar-sdk';

describe('StellarHealthIndicator', () => {
  const makeIndicator = () => {
    const stellarConfig = {
      horizonUrl: 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      network: 'testnet',
    } as any;
    return new StellarHealthIndicator(stellarConfig);
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns up when Horizon responds with a ledger', async () => {
    mockLedgersCall.mockResolvedValue({ records: [{ sequence: 12345 }] });
    const result = await makeIndicator().isHealthy('stellar');
    expect(result.stellar.status).toBe('up');
  });

  it('includes latestLedger and latency in the up result', async () => {
    mockLedgersCall.mockResolvedValue({ records: [{ sequence: 99999 }] });
    const result = await makeIndicator().isHealthy('stellar');
    expect(result.stellar.latestLedger).toBe(99999);
    expect(result.stellar.latency).toMatch(/\d+ms/);
  });

  it('throws HealthCheckError when Horizon call fails', async () => {
    mockLedgersCall.mockRejectedValue(new Error('network error'));
    await expect(makeIndicator().isHealthy('stellar')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('includes error message in the down result', async () => {
    mockLedgersCall.mockRejectedValue(new Error('503 Service Unavailable'));
    try {
      await makeIndicator().isHealthy('stellar');
    } catch (err) {
      expect((err as HealthCheckError).causes).toMatchObject({
        stellar: { status: 'down', error: '503 Service Unavailable' },
      });
    }
  });
});

// ── SorobanHealthIndicator ────────────────────────────────────────────────────
// SorobanRpc.Server is instantiated inside isHealthy() on each call,
// so we capture the mock instance after the call.

describe('SorobanHealthIndicator', () => {
  const makeIndicator = () => {
    const stellarConfig = {
      horizonUrl: 'https://horizon-testnet.stellar.org',
      sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
      network: 'testnet',
    } as any;
    return new SorobanHealthIndicator(stellarConfig);
  };

  const getSorobanMock = () =>
    (StellarSdk.SorobanRpc.Server as unknown as jest.Mock).mock.results.at(-1)!.value as {
      getHealth: jest.Mock;
    };

  beforeEach(() => jest.clearAllMocks());

  it('returns up when Soroban RPC reports healthy', async () => {
    // Pre-configure the mock factory so the instance returned has getHealth resolved
    (StellarSdk.SorobanRpc.Server as unknown as jest.Mock).mockImplementationOnce(() => ({
      getHealth: jest.fn().mockResolvedValue({ status: 'healthy' }),
    }));
    const result = await makeIndicator().isHealthy('soroban');
    // The indicator passes status from RPC response which overwrites terminus's 'up'
    expect(result.soroban.status).toBe('healthy');
  });

  it('includes latency in the up result', async () => {
    (StellarSdk.SorobanRpc.Server as unknown as jest.Mock).mockImplementationOnce(() => ({
      getHealth: jest.fn().mockResolvedValue({ status: 'healthy' }),
    }));
    const result = await makeIndicator().isHealthy('soroban');
    expect(result.soroban.latency).toMatch(/\d+ms/);
  });

  it('throws HealthCheckError when Soroban RPC call fails', async () => {
    (StellarSdk.SorobanRpc.Server as unknown as jest.Mock).mockImplementationOnce(() => ({
      getHealth: jest.fn().mockRejectedValue(new Error('RPC unavailable')),
    }));
    await expect(makeIndicator().isHealthy('soroban')).rejects.toBeInstanceOf(HealthCheckError);
  });

  it('includes error message in the down result', async () => {
    (StellarSdk.SorobanRpc.Server as unknown as jest.Mock).mockImplementationOnce(() => ({
      getHealth: jest.fn().mockRejectedValue(new Error('connection timeout')),
    }));
    try {
      await makeIndicator().isHealthy('soroban');
    } catch (err) {
      expect((err as HealthCheckError).causes).toMatchObject({
        soroban: { status: 'down', error: 'connection timeout' },
      });
    }
  });
});
