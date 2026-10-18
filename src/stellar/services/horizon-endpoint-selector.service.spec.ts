import { HorizonEndpointSelectorService } from './horizon-endpoint-selector.service';
import { StellarConfigService } from '../../config/stellar.service';

function fakeConfig(urls: string[]): StellarConfigService {
  return {
    horizonUrls: urls,
    horizonUrl: urls[0],
    network: 'testnet',
    networkPassphrase: 'Test SDF Network ; September 2015',
  } as unknown as StellarConfigService;
}

describe('HorizonEndpointSelectorService', () => {
  const URLS = ['https://horizon-a.example.org', 'https://horizon-b.example.org', 'https://horizon-c.example.org'];

  it('round-robins across all endpoints when all are healthy', () => {
    const service = new HorizonEndpointSelectorService(fakeConfig(URLS));
    const selected = [service.selectEndpoint(), service.selectEndpoint(), service.selectEndpoint()];
    expect(new Set(selected)).toEqual(new Set(URLS));
  });

  it('avoids an endpoint after enough consecutive failures', () => {
    const service = new HorizonEndpointSelectorService(fakeConfig(URLS));
    const bad = URLS[0];

    service.reportFailure(bad);
    service.reportFailure(bad);
    service.reportFailure(bad); // 3rd failure trips the threshold

    const status = service.getStatus();
    expect(status.find((e) => e.url === bad)?.healthy).toBe(false);

    for (let i = 0; i < 10; i++) {
      expect(service.selectEndpoint()).not.toBe(bad);
    }
  });

  it('rejoins a recovered endpoint as soon as a success is reported', () => {
    const service = new HorizonEndpointSelectorService(fakeConfig(URLS));
    const bad = URLS[0];

    service.reportFailure(bad);
    service.reportFailure(bad);
    service.reportFailure(bad);
    expect(service.getStatus().find((e) => e.url === bad)?.healthy).toBe(false);

    service.reportSuccess(bad);
    const status = service.getStatus().find((e) => e.url === bad);
    expect(status?.healthy).toBe(true);
    expect(status?.consecutiveFailures).toBe(0);
  });

  it('a success resets the failure counter without needing to trip unhealthy first', () => {
    const service = new HorizonEndpointSelectorService(fakeConfig(URLS));
    const url = URLS[0];
    service.reportFailure(url);
    service.reportFailure(url);
    service.reportSuccess(url);
    expect(service.getStatus().find((e) => e.url === url)?.consecutiveFailures).toBe(0);
  });

  it('fails open and keeps selecting among all endpoints when every endpoint is unhealthy', () => {
    const service = new HorizonEndpointSelectorService(fakeConfig(URLS));
    for (const url of URLS) {
      service.reportFailure(url);
      service.reportFailure(url);
      service.reportFailure(url);
    }
    expect(service.getStatus().every((e) => !e.healthy)).toBe(true);

    // Still returns a usable URL from the configured set rather than throwing.
    for (let i = 0; i < 5; i++) {
      expect(URLS).toContain(service.selectEndpoint());
    }
  });

  it('re-admits an unhealthy endpoint for a probe after the cooldown elapses', () => {
    const service = new HorizonEndpointSelectorService(fakeConfig(URLS));
    const bad = URLS[0];
    service.reportFailure(bad);
    service.reportFailure(bad);
    service.reportFailure(bad);
    expect(service.getStatus().find((e) => e.url === bad)?.healthy).toBe(false);

    // Simulate cooldown elapsing.
    const endpoint = (service as any).endpoints.find((e: any) => e.url === bad);
    endpoint.markedUnhealthyAt = new Date(Date.now() - 61_000);

    service.selectEndpoint(); // triggers admitCooldownCandidates()
    expect(service.getStatus().find((e) => e.url === bad)?.healthy).toBe(true);
  });

  it('hasFailover() reflects whether more than one endpoint is configured', () => {
    expect(new HorizonEndpointSelectorService(fakeConfig(URLS)).hasFailover()).toBe(true);
    expect(new HorizonEndpointSelectorService(fakeConfig([URLS[0]])).hasFailover()).toBe(false);
  });

  it('never exposes a way to change network identity — only horizonUrls are read', () => {
    const config = fakeConfig(URLS);
    const service = new HorizonEndpointSelectorService(config);
    service.selectEndpoint();
    service.reportFailure(URLS[0]);
    service.reportSuccess(URLS[1]);
    // network/networkPassphrase on the config object are untouched by any
    // selector operation — the selector has no setter for them at all.
    expect(config.network).toBe('testnet');
    expect(config.networkPassphrase).toBe('Test SDF Network ; September 2015');
  });

  it('reportSuccess/reportFailure for an unknown url are no-ops', () => {
    const service = new HorizonEndpointSelectorService(fakeConfig(URLS));
    expect(() => service.reportSuccess('https://not-configured.example.org')).not.toThrow();
    expect(() => service.reportFailure('https://not-configured.example.org')).not.toThrow();
  });
});
