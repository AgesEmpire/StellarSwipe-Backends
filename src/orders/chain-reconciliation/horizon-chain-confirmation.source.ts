import { Injectable, Logger } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { StellarConfigService } from '../../config/stellar.service';
import { ChainConfirmationSource, ChainObservation } from './chain-confirmation.source';

const MAX_SOURCES = 3;

/**
 * Queries every configured Horizon endpoint (stellar.horizonUrls, #1373) for
 * a transaction hash, so the reconciliation policy can detect endpoints that
 * disagree instead of trusting whichever answered first.
 */
@Injectable()
export class HorizonChainConfirmationSource implements ChainConfirmationSource {
  private readonly logger = new Logger(HorizonChainConfirmationSource.name);
  private readonly servers = new Map<string, StellarSdk.Horizon.Server>();

  constructor(private readonly stellarConfig: StellarConfigService) {}

  private urls(): string[] {
    const urls = (this.stellarConfig.horizonUrls ?? []).filter(Boolean);
    const unique = [...new Set(urls.length ? urls : [this.stellarConfig.horizonUrl])];
    return unique.slice(0, MAX_SOURCES);
  }

  private server(url: string): StellarSdk.Horizon.Server {
    let server = this.servers.get(url);
    if (!server) {
      server = new StellarSdk.Horizon.Server(url);
      this.servers.set(url, server);
    }
    return server;
  }

  async lookup(txHash: string): Promise<ChainObservation[]> {
    return Promise.all(this.urls().map((url) => this.lookupOne(url, txHash)));
  }

  private async lookupOne(url: string, txHash: string): Promise<ChainObservation> {
    const observedAt = new Date().toISOString();
    try {
      const tx: any = await this.server(url).transactions().transaction(txHash).call();
      const ledger = tx.ledger_attr ?? tx.ledger;
      return {
        source: url,
        outcome: tx.successful === false ? 'failed' : 'success',
        hash: tx.hash,
        ledger: ledger !== undefined ? Number(ledger) : undefined,
        resultCode: tx.successful === false ? 'tx_failed' : 'tx_success',
        feeCharged: tx.fee_charged !== undefined ? String(tx.fee_charged) : undefined,
        observedAt,
      };
    } catch (err) {
      const status = (err as any)?.response?.status as number | undefined;
      if (status === 404) {
        return { source: url, outcome: 'not_found', observedAt };
      }
      this.logger.warn(`Horizon ${url} lookup for ${txHash} failed (status=${status ?? 'n/a'})`);
      return { source: url, outcome: 'error', error: `HTTP ${status ?? 'unavailable'}`, observedAt };
    }
  }
}
