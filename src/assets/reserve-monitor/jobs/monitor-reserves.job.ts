import { Injectable, Logger } from '@nestjs/common';
import { ReserveMonitorService } from '../reserve-monitor.service';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MonitorReservesJob {
  private readonly logger = new Logger(MonitorReservesJob.name);
  constructor(private readonly service: ReserveMonitorService, private readonly config: ConfigService) {}

  async run(): Promise<void> {
    const cfg = this.config.get<string>('RESERVE_ASSETS') || ''; // format: CODE:ISSUER:THRESHOLD,CSV
    if (!cfg) return this.logger.debug('No RESERVE_ASSETS configured');
    const entries = cfg.split(',').map((s) => s.trim()).filter(Boolean);
    for (const e of entries) {
      const parts = e.split(':');
      const code = parts[0];
      const issuer = parts[1];
      const threshold = parseFloat(parts[2] || '0');
      const res = await this.service.checkAssetReserve(code, issuer, threshold);
      if (res.below) {
        this.logger.warn(`Reserve alert for ${code}:${issuer} — current=${res.current} threshold=${threshold}`);
      } else {
        this.logger.log(`Reserve OK for ${code}:${issuer} — current=${res.current}`);
      }
    }
  }
}
