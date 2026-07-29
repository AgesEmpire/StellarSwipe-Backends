import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Asset, Horizon } from '@stellar/stellar-sdk';
import { StellarConfigService } from '../../config/stellar.service';
import { ConfigService } from '../../config/config.service';
import { HorizonBulkheadService } from '../../stellar/bulkhead/horizon-bulkhead.service';
import { SlippageExceededException } from '../exceptions/slippage-exceeded.exception';

@Injectable()
export class SlippageGuardService {
  private readonly server: Horizon.Server;
  private readonly logger = new Logger(SlippageGuardService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly stellarConfig: StellarConfigService,
    private readonly bulkhead: HorizonBulkheadService,
  ) {
    this.server = new Horizon.Server(this.stellarConfig.horizonUrl, {
      allowHttp: this.stellarConfig.horizonUrl.startsWith('http://'),
    });
  }

  /**
   * Verifies that the current live price hasn't shifted unfavorably beyond the allowed slippage.
   *
   * @param sellingAssetStr The asset being sold (e.g., 'XLM' or 'USDC:G...')
   * @param buyingAssetStr The asset being bought
   * @param referencePrice The initial intended price (e.g., signal entry price)
   * @param overrideBps Optional per-request or per-asset slippage tolerance in basis points
   * @throws SlippageExceededException if deviation > allowed bps
   */
  async verifySlippage(
    sellingAssetStr: string,
    buyingAssetStr: string,
    referencePrice: number,
    overrideBps?: number,
  ): Promise<void> {
    const allowedBps = overrideBps ?? this.configService.slippageToleranceBps;

    const sellingAsset = this.parseAsset(sellingAssetStr);
    const buyingAsset = this.parseAsset(buyingAssetStr);

    if (sellingAsset.equals(buyingAsset)) {
      throw new BadRequestException('Cannot trade an asset for itself');
    }

    // Fetch orderbook to get live price
    const livePrice = await this.fetchLivePrice(sellingAsset, buyingAsset);

    // Calculate percentage deviation in basis points
    // Deviation = |Live - Ref| / Ref * 10000
    const deviationBps = Number((Math.abs((livePrice - referencePrice) / referencePrice) * 10000).toFixed(4));

    this.logger.debug(
      `Slippage check - Ref: ${referencePrice}, Live: ${livePrice}, Deviation: ${Math.round(
        deviationBps,
      )} bps, Allowed: ${allowedBps} bps`,
    );

    if (deviationBps > allowedBps) {
      throw new SlippageExceededException(
        referencePrice,
        livePrice,
        deviationBps,
        allowedBps,
      );
    }
  }

  private async fetchLivePrice(selling: Asset, buying: Asset): Promise<number> {
    try {
      const orderbook = await this.bulkhead.read(() =>
        this.server.orderbook(selling, buying).limit(1).call(),
      );

      const bids = orderbook.bids || [];
      if (bids.length === 0) {
        throw new BadRequestException(
          'No liquidity available in the order book for this trading pair to check slippage',
        );
      }

      return Number(bids[0].price);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(`Failed to fetch live price: ${(error as Error).message}`);
      throw new BadRequestException(
        'Unable to fetch order book data to verify slippage',
      );
    }
  }

  private parseAsset(assetStr: string): Asset {
    if (assetStr === 'XLM' || assetStr === 'native') {
      return Asset.native();
    }
    const [code, issuer] = assetStr.split(':');
    if (!code || !issuer) {
      // If no issuer is provided but it's not XLM, we can't build a valid Stellar Asset
      // Some parts of the system might just pass 'USDC' without issuer if mocked.
      // We throw to ensure strictly valid formats, or if mocked we could return a dummy.
      // For real stellar usage, issuer is required for non-native.
      throw new BadRequestException(`Invalid asset format: ${assetStr}. Expected CODE:ISSUER or XLM`);
    }
    return new Asset(code, issuer);
  }
}
