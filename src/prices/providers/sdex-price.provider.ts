import { Injectable, Logger } from '@nestjs/common';
import { Server } from 'stellar-sdk';
import { PriceSourceResult } from '../dto/price-data.dto';

@Injectable()
export class SdexPriceProvider {
  private readonly logger = new Logger(SdexPriceProvider.name);
  private readonly server: Server;

  constructor() {
    this.server = new Server('https://horizon.stellar.org');
  }

  async getPrice(assetPair: string): Promise<PriceSourceResult> {
    try {
      const [base, counter] = this.parseAssetPair(assetPair);

      const orderbook = await this.server
        .orderbook(base, counter)
        .limit(10)
        .call();

      if (!orderbook.bids.length || !orderbook.asks.length) {
        throw new Error('No liquidity on SDEX');
      }

      const midPrice =
        (parseFloat(orderbook.bids[0].price) +
          parseFloat(orderbook.asks[0].price)) /
        2;

      return {
        price: midPrice,
        source: 'SDEX',
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `SDEX price fetch failed for ${assetPair}: ${error.message}`,
      );
      throw error;
    }
  }

  private parseAssetPair(assetPair: string) {
    // Format: "XLM-USDC" or "ASSET_CODE:ISSUER-ASSET_CODE:ISSUER"
    const [baseStr, counterStr] = assetPair.split('-');
    return [this.parseAsset(baseStr), this.parseAsset(counterStr)];
  }

  private parseAsset(assetStr: string) {
    if (assetStr === 'XLM') {
      return { isNative: () => true };
    }
    const [code, issuer] = assetStr.split(':');
    return { getCode: () => code, getIssuer: () => issuer };
  }
}
