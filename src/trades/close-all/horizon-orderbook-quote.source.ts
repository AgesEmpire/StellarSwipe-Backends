import { Injectable, Logger } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarConfigService } from '../../config/stellar.service';
import { CloseQuote, CloseQuoteRequest, CloseQuoteSource } from './close-all.types';
import { estimateFill } from './orderbook-estimate';

const ISSUER_RE = /^G[A-Z2-7]{55}$/;

/** Accepts "XLM" / "native", or "CODE:ISSUER" / "CODE-ISSUER". Returns null when the issuer is unknown. */
export function parseStellarAsset(value: string): StellarSdk.Asset | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  if (v.toUpperCase() === 'XLM' || v.toLowerCase() === 'native') return StellarSdk.Asset.native();
  const [code, issuer] = v.split(/[:-]/);
  if (!code || !issuer || !ISSUER_RE.test(issuer)) return null;
  try {
    return new StellarSdk.Asset(code, issuer);
  } catch {
    return null;
  }
}

/**
 * Read-only quote from the live SDEX order book: walks bids (closing a long)
 * or asks (closing a short) for the position size to estimate the average
 * fill price and slippage.
 */
@Injectable()
export class HorizonOrderbookQuoteSource implements CloseQuoteSource {
  private readonly logger = new Logger(HorizonOrderbookQuoteSource.name);
  private server?: StellarSdk.Horizon.Server;

  constructor(private readonly stellarConfig: StellarConfigService) {}

  async quote(request: CloseQuoteRequest): Promise<CloseQuote | null> {
    const base = parseStellarAsset(request.baseAsset);
    const counter = parseStellarAsset(request.counterAsset);
    if (!base || !counter) return null;

    this.server ??= new StellarSdk.Horizon.Server(this.stellarConfig.horizonUrl);
    try {
      const book: any = await this.server.orderbook(base, counter).limit(200).call();
      const side = request.direction === 'sell_base' ? 'bids' : 'asks';
      const fill = estimateFill(book[side] ?? [], request.amount, side);
      if (!fill) return null;
      return {
        bestPrice: fill.bestPrice,
        averagePrice: fill.averagePrice,
        sufficientLiquidity: fill.sufficientLiquidity,
        source: `horizon-orderbook:${this.stellarConfig.horizonUrl}`,
        asOf: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(`Order book lookup failed for ${request.baseAsset}/${request.counterAsset}: ${(error as Error).message}`);
      return null;
    }
  }
}
