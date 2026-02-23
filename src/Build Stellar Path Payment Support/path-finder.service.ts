import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Horizon,
  Asset,
} from '@stellar/stellar-sdk';
import { AssetDto, PathResultDto } from './dto/path-payment.dto';

@Injectable()
export class PathFinderService {
  private readonly logger = new Logger(PathFinderService.name);
  private readonly server: Horizon.Server;

  constructor(private readonly configService: ConfigService) {
    const horizonUrl =
      this.configService.get<string>('STELLAR_HORIZON_URL') ||
      'https://horizon-testnet.stellar.org';
    this.server = new Horizon.Server(horizonUrl);
  }

  // ─────────────────────────────────────────────
  //  Public API
  // ─────────────────────────────────────────────

  /**
   * Discover all viable payment paths between two assets.
   * Returns paths sorted by best source amount (cheapest first).
   */
  async findPaths(
    sourceAccount: string,
    sourceAsset: AssetDto,
    destinationAsset: AssetDto,
    destinationAmount: string,
    slippageTolerance: number = 1,
  ): Promise<PathResultDto[]> {
    const stellarDestAsset = this.toStellarAsset(destinationAsset);

    try {
      // Use Horizon's strict-receive path finding
      const response = await this.server
        .strictReceivePaths(
          [this.toStellarAsset(sourceAsset)], // allowed source assets
          stellarDestAsset,
          destinationAmount,
        )
        .call();

      const paths: PathResultDto[] = response.records.map((record) =>
        this.mapRecord(record, destinationAmount, slippageTolerance),
      );

      this.logger.log(
        `Found ${paths.length} path(s) for ${sourceAsset.code} → ${destinationAsset.code}`,
      );

      // Sort ascending by source amount (user pays least)
      return paths.sort(
        (a, b) => parseFloat(a.sourceAmount) - parseFloat(b.sourceAmount),
      );
    } catch (error) {
      this.logger.warn(`Path finding failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Select the optimal path from a list of discovered paths.
   * Strategy: lowest source amount first, then fewest hops as tiebreaker.
   */
  selectBestPath(paths: PathResultDto[]): PathResultDto | null {
    if (!paths.length) return null;

    return paths.reduce((best, current) => {
      const bestAmount = parseFloat(best.sourceAmount);
      const currentAmount = parseFloat(current.sourceAmount);

      if (currentAmount < bestAmount) return current;
      if (currentAmount === bestAmount && current.hops < best.hops)
        return current;
      return best;
    });
  }

  /**
   * Calculate slippage-adjusted maximum source amount for a given path.
   * This becomes the `sendMax` parameter in the Stellar transaction.
   */
  calculateSendMax(sourceAmount: string, slippageTolerance: number): string {
    const amount = parseFloat(sourceAmount);
    const multiplier = 1 + slippageTolerance / 100;
    return (amount * multiplier).toFixed(7);
  }

  /**
   * Build a direct (single-hop) path result for fallback purposes.
   * Does not guarantee execution – caller must check orderbook liquidity.
   */
  buildDirectPath(
    sourceAsset: AssetDto,
    destinationAsset: AssetDto,
    sourceAmount: string,
    destinationAmount: string,
    slippageTolerance: number,
  ): PathResultDto {
    const srcAmt = parseFloat(sourceAmount);
    const dstAmt = parseFloat(destinationAmount);

    return {
      path: [],           // empty path = direct trade on Stellar
      sourceAmount,
      destinationAmount,
      slippage: this.estimateSlippage(srcAmt, dstAmt, slippageTolerance),
      hops: 0,
      priceRatio: dstAmt / srcAmt,
    };
  }

  // ─────────────────────────────────────────────
  //  Helpers
  // ─────────────────────────────────────────────

  toStellarAsset(asset: AssetDto): Asset {
    if (asset.code === 'XLM' && !asset.issuer) return Asset.native();
    if (!asset.issuer) {
      throw new Error(`Issuer required for non-native asset: ${asset.code}`);
    }
    return new Asset(asset.code, asset.issuer);
  }

  private mapRecord(
    record: Horizon.ServerApi.PaymentPathRecord,
    destinationAmount: string,
    slippageTolerance: number,
  ): PathResultDto {
    const srcAmt = parseFloat(record.source_amount);
    const dstAmt = parseFloat(destinationAmount);
    const intermediaryPath: AssetDto[] = record.path.map((p) => ({
      code: p.asset_type === 'native' ? 'XLM' : p.asset_code!,
      issuer: p.asset_type === 'native' ? undefined : p.asset_issuer,
    }));

    return {
      path: intermediaryPath,
      sourceAmount: record.source_amount,
      destinationAmount,
      slippage: this.estimateSlippage(srcAmt, dstAmt, slippageTolerance),
      hops: intermediaryPath.length + 1,
      priceRatio: dstAmt / srcAmt,
    };
  }

  /**
   * Estimate effective slippage given a tolerance threshold.
   * In production you'd compare against a reference price oracle.
   */
  private estimateSlippage(
    _sourceAmount: number,
    _destinationAmount: number,
    slippageTolerance: number,
  ): number {
    // Simplified: return a fraction of the tolerance as estimated slippage
    // Replace with oracle-based calculation for production
    return parseFloat((slippageTolerance * 0.3).toFixed(4));
  }
}
