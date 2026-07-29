import { Test } from '@nestjs/testing';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';

const TOKEN = 'secret-internal-token';

const makeCacheMock = () => ({
  get: jest.fn(),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
});

async function buildService(token = TOKEN) {
  const cache = makeCacheMock();
  const module = await Test.createTestingModule({
    providers: [
      DiscoveryService,
      { provide: CACHE_MANAGER, useValue: cache },
      {
        provide: ConfigService,
        useValue: { get: jest.fn().mockReturnValue(token) },
      },
    ],
  }).compile();

  const svc = module.get(DiscoveryService);
  svc.onModuleInit();
  return { svc, cache };
}

describe('DiscoveryService', () => {
  it('register() stores instance and returns it', async () => {
    const { svc, cache } = await buildService();
    const result = await svc.register('signals-svc', 'http://signals:3001', TOKEN);

    expect(cache.set).toHaveBeenCalledWith(
      'discovery:service:signals-svc',
      expect.objectContaining({ name: 'signals-svc', url: 'http://signals:3001' }),
      60_000,
    );
    expect(result.name).toBe('signals-svc');
    expect(result.url).toBe('http://signals:3001');
  });

  it('register() rejects invalid token', async () => {
    const { svc } = await buildService();
    await expect(svc.register('svc', 'http://x', 'wrong-token')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('heartbeat() updates lastHeartbeat when service exists', async () => {
    const { svc, cache } = await buildService();
    const existing = {
      name: 'signals-svc',
      url: 'http://signals:3001',
      registeredAt: new Date().toISOString(),
      lastHeartbeat: new Date(0).toISOString(),
    };
    cache.get.mockResolvedValueOnce(existing);

    await svc.heartbeat('signals-svc', TOKEN);

    expect(cache.set).toHaveBeenCalledWith(
      'discovery:service:signals-svc',
      expect.objectContaining({ lastHeartbeat: expect.any(String) }),
      60_000,
    );
  });

  it('heartbeat() is a no-op for unknown service', async () => {
    const { svc, cache } = await buildService();
    cache.get.mockResolvedValueOnce(null);
    await expect(svc.heartbeat('unknown', TOKEN)).resolves.not.toThrow();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('heartbeat() rejects invalid token', async () => {
    const { svc } = await buildService();
    await expect(svc.heartbeat('svc', 'bad')).rejects.toThrow(UnauthorizedException);
  });

  it('deregister() removes the cache key', async () => {
    const { svc, cache } = await buildService();
    await svc.deregister('signals-svc', TOKEN);
    expect(cache.del).toHaveBeenCalledWith('discovery:service:signals-svc');
  });

  it('deregister() rejects invalid token', async () => {
    const { svc } = await buildService();
    await expect(svc.deregister('svc', 'bad')).rejects.toThrow(UnauthorizedException);
  });

  it('resolve() returns url when service is registered', async () => {
    const { svc, cache } = await buildService();
    cache.get.mockResolvedValueOnce({ url: 'http://signals:3001' });
    expect(await svc.resolve('signals-svc')).toBe('http://signals:3001');
  });

  it('resolve() returns null when service is not found', async () => {
    const { svc, cache } = await buildService();
    cache.get.mockResolvedValueOnce(null);
    expect(await svc.resolve('missing')).toBeNull();
  });

  it('listServices() returns only non-null instances', async () => {
    const { svc, cache } = await buildService();
    cache.get
      .mockResolvedValueOnce(['signals-svc', 'trades-svc']) // index
      .mockResolvedValueOnce({ name: 'signals-svc', url: 'http://signals:3001' })
      .mockResolvedValueOnce(null); // trades-svc expired

    const list = await svc.listServices();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('signals-svc');
  });
});
