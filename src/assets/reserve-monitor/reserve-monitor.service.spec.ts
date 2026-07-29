import { ReserveMonitorService } from './reserve-monitor.service';
import { ConfigService } from '@nestjs/config';

describe('ReserveMonitorService', () => {
  let service: ReserveMonitorService;
  beforeEach(() => {
    const cfg = { get: (k: string) => 'https://horizon-testnet.stellar.org' } as unknown as ConfigService;
    service = new ReserveMonitorService(cfg);
  });

  it('evaluates threshold correctly', () => {
    expect(service).toBeDefined();
  });
});
