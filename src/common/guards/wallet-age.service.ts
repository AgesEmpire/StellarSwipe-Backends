import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Horizon } from '@stellar/stellar-sdk';

@Injectable()
export class WalletAgeService {
  private readonly logger = new Logger(WalletAgeService.name);
  private readonly server: Horizon.Server;

  constructor(private readonly configService: ConfigService) {
    const horizonUrl =
      this.configService.get<string>('stellar.horizonUrl') ??
      'https://horizon-testnet.stellar.org';
    this.server = new Horizon.Server(horizonUrl);
  }

  /**
   * Returns the UTC Date when the Stellar account was created, derived from
   * the earliest `account_created` effect on-chain.
   * Throws if the account does not exist on the network.
   */
  async getAccountCreatedAt(publicKey: string): Promise<Date> {
    const effects = await this.server
      .effects()
      .forAccount(publicKey)
      .order('asc')
      .limit(1)
      .call();

    const first = effects.records[0];
    if (!first) {
      throw new Error(`No effects found for account ${publicKey}`);
    }

    return new Date(first.created_at);
  }

  /**
   * Returns true when the account is at least `minimumAgeDays` old.
   */
  async isOldEnough(publicKey: string, minimumAgeDays: number): Promise<boolean> {
    const createdAt = await this.getAccountCreatedAt(publicKey);
    const ageMs = Date.now() - createdAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    return ageDays >= minimumAgeDays;
  }
}
