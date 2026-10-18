const mockServerFactory = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Horizon: {
      Server: jest.fn().mockImplementation((url: string) => mockServerFactory(url)),
    },
  };
});

import { ServiceUnavailableException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { CircuitBreakerService } from '../../http/circuit-breaker.service';
import { HorizonEndpointSelectorService } from './horizon-endpoint-selector.service';
import { StellarProviderService } from './stellar-provider.service';
import { StellarConfigService } from '../../config/stellar.service';

describe('StellarProviderService — Horizon endpoint failover (#1373)', () => {
  const URL_A = 'https://horizon-a.example.org';
  const URL_B = 'https://horizon-b.example.org';

  let service: StellarProviderService;
  let endpointSelector: HorizonEndpointSelectorService;
  let circuitBreaker: CircuitBreakerService;
  let stellarConfig: StellarConfigService;
  let serversByUrl: Map<string, { loadAccount: jest.Mock }>;

  beforeEach(() => {
    serversByUrl = new Map();
    mockServerFactory.mockImplementation((url: string) => {
      if (!serversByUrl.has(url)) {
        serversByUrl.set(url, { loadAccount: jest.fn() });
      }
      return serversByUrl.get(url);
    });

    stellarConfig = {
      horizonUrl: URL_A,
      horizonUrls: [URL_A, URL_B],
      network: 'testnet',
      networkPassphrase: 'Test SDF Network ; September 2015',
    } as unknown as StellarConfigService;

    circuitBreaker = new CircuitBreakerService();
    jest.spyOn((circuitBreaker as any).logger, 'warn').mockImplementation(() => {});
    jest.spyOn((circuitBreaker as any).logger, 'log').mockImplementation(() => {});

    endpointSelector = new HorizonEndpointSelectorService(stellarConfig);
    service = new StellarProviderService(stellarConfig, circuitBreaker, endpointSelector);
  });

  afterEach(() => jest.clearAllMocks());

  it('reports success back to the endpoint selector on a healthy call', async () => {
    const reportSuccessSpy = jest.spyOn(endpointSelector, 'reportSuccess');
    const firstUrl = (endpointSelector as any).endpoints[0].url;
    serversByUrl.set(firstUrl, { loadAccount: jest.fn().mockResolvedValue({ id: 'GABC' }) });
    mockServerFactory.mockImplementation((url: string) => serversByUrl.get(url) ?? { loadAccount: jest.fn() });

    jest.spyOn(endpointSelector, 'selectEndpoint').mockReturnValue(firstUrl);

    const result = await service.loadAccount('GABC');

    expect(result).toEqual({ id: 'GABC' });
    expect(reportSuccessSpy).toHaveBeenCalledWith(firstUrl);
  });

  it('reports failure to the endpoint selector and rethrows when a call fails', async () => {
    const failingServer = { loadAccount: jest.fn().mockRejectedValue(new Error('timeout')) };
    mockServerFactory.mockReturnValue(failingServer);
    jest.spyOn(endpointSelector, 'selectEndpoint').mockReturnValue(URL_A);
    const reportFailureSpy = jest.spyOn(endpointSelector, 'reportFailure');

    await expect(service.loadAccount('GABC')).rejects.toThrow('timeout');
    expect(reportFailureSpy).toHaveBeenCalledWith(URL_A);
  });

  it('fails over to the next healthy endpoint once the first is marked unhealthy', async () => {
    const serverA = { loadAccount: jest.fn().mockRejectedValue(new Error('down')) };
    const serverB = { loadAccount: jest.fn().mockResolvedValue({ id: 'GXYZ' }) };
    mockServerFactory.mockImplementation((url: string) => (url === URL_A ? serverA : serverB));

    // Drive endpoint A unhealthy via real failure reporting.
    for (let i = 0; i < 3; i++) {
      jest.spyOn(endpointSelector, 'selectEndpoint').mockReturnValueOnce(URL_A);
      await expect(service.loadAccount('G1')).rejects.toThrow('down');
    }
    expect(endpointSelector.getStatus().find((e) => e.url === URL_A)?.healthy).toBe(false);

    // Selector (unmocked now) should steer subsequent calls to the healthy endpoint B.
    const result = await service.loadAccount('G2');
    expect(result).toEqual({ id: 'GXYZ' });
    expect(serverB.loadAccount).toHaveBeenCalled();
  });

  it('never changes network identity when failing over between endpoints', async () => {
    jest.spyOn(endpointSelector, 'selectEndpoint').mockReturnValueOnce(URL_A).mockReturnValueOnce(URL_B);
    mockServerFactory.mockImplementation(() => ({ loadAccount: jest.fn().mockResolvedValue({}) }));

    await service.loadAccount('G1');
    await service.loadAccount('G2');

    expect(stellarConfig.network).toBe('testnet');
    expect(stellarConfig.networkPassphrase).toBe('Test SDF Network ; September 2015');
  });

  it('opens the read circuit after repeated failures regardless of which endpoint is used', async () => {
    mockServerFactory.mockReturnValue({ loadAccount: jest.fn().mockRejectedValue(new Error('fail')) });

    for (let i = 0; i < 5; i++) {
      await expect(service.loadAccount('G1')).rejects.toThrow();
    }

    await expect(service.loadAccount('G1')).rejects.toThrow(ServiceUnavailableException);
  });

  it('caches one SDK server instance per endpoint URL', async () => {
    mockServerFactory.mockImplementation((url: string) => ({
      loadAccount: jest.fn().mockResolvedValue({ url }),
    }));
    jest.spyOn(endpointSelector, 'selectEndpoint').mockReturnValue(URL_A);

    await service.loadAccount('G1');
    await service.loadAccount('G2');

    const horizonServerCtor = StellarSdk.Horizon.Server as unknown as jest.Mock;
    const callsForUrlA = horizonServerCtor.mock.calls.filter((args: any[]) => args[0] === URL_A);
    expect(callsForUrlA).toHaveLength(1);
  });
});
