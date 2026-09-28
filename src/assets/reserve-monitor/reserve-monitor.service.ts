import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'stellar-sdk';
import { ConfigService } from '@nestjs/config';
import { isBelowThreshold } from './utils/threshold-evaluator';

@Injectable()
export class ReserveMonitorService {
  private readonly logger = new Logger(ReserveMonitorService.name);
  private server: Server;

  constructor(private readonly config: ConfigService) {
    this.server = new Server(this.config.get<string>('HORIZON_URL') || 'https://horizon-testnet.stellar.org');
  }

  async checkAssetReserve(assetCode: string, issuer: string, threshold: number): Promise<{ below: boolean; current: number }> {
    try {
      const account = await this.server.loadAccount(issuer);
      const bal = account.balances || [];
      if (assetCode === 'XLM') {
        const native = bal.find((b: any) => b.asset_type === 'native');
        const current = parseFloat(native?.balance || '0');
        return { below: isBelowThreshold(current, threshold), current };
      }

      const found = bal.find((b: any) => b.asset_code === assetCode && b.asset_issuer === issuer);
      const current = parseFloat(found?.balance || '0');
      return { below: isBelowThreshold(current, threshold), current };
    } catch (err) {
      this.logger.error(`Failed to fetch reserve for ${assetCode}:${issuer}`, err);
      // On error consider it below to trigger alerting downstream
      return { below: true, current: 0 };
    }
  }
}
