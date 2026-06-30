import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { ConfigService } from '@nestjs/config';
import {
  CreateClaimableBalanceDto,
  ClaimBalanceDto,
  ReclaimExpiredBalanceDto,
  ClaimPredicateType,
} from './claimable-balance.dto';

@Injectable()
export class ClaimableBalanceService {
  private readonly logger = new Logger(ClaimableBalanceService.name);
  private readonly server: StellarSdk.Horizon.Server;
  private readonly networkPassphrase: string;

  constructor(private readonly configService: ConfigService) {
    const horizonUrl = this.configService.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    this.server = new StellarSdk.Horizon.Server(horizonUrl);
    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK') === 'mainnet'
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET;
  }

  /**
   * Creates a claimable balance for a recipient with an optional time-bound predicate.
   * Used instead of direct payment when the recipient may not have a trustline yet.
   */
  async createClaimableBalance(dto: CreateClaimableBalanceDto): Promise<{ balanceId: string; hash: string }> {
    const sponsorKeypair = StellarSdk.Keypair.fromSecret(dto.sponsorSecretKey);
    const asset = dto.assetCode === 'XLM'
      ? StellarSdk.Asset.native()
      : new StellarSdk.Asset(dto.assetCode, dto.assetIssuer!);

    const predicate = this.buildPredicate(dto.predicateType, dto.predicateValue);

    const sponsorAccount = await this.server.loadAccount(sponsorKeypair.publicKey());
    const fee = await this.server.fetchBaseFee();

    const tx = new StellarSdk.TransactionBuilder(sponsorAccount, {
      fee: String(fee),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.createClaimableBalance({
          asset,
          amount: dto.amount,
          claimants: [new StellarSdk.Claimant(dto.recipientAddress, predicate)],
        }),
      )
      .setTimeout(30)
      .build();

    tx.sign(sponsorKeypair);
    const result = await this.server.submitTransaction(tx);

    // The balance ID is derived from the transaction hash and operation index (0)
    const balanceId = StellarSdk.StrKey.encodePreAuthTx
      ? this.extractBalanceId(result)
      : (result as any).balance_id ?? result.hash;

    this.logger.log(
      `Claimable balance created: recipient=${dto.recipientAddress} amount=${dto.amount} ${dto.assetCode} hash=${result.hash}`,
    );

    return { balanceId: balanceId, hash: result.hash };
  }

  /**
   * Allows the entitled claimant to claim an outstanding balance.
   */
  async claimBalance(dto: ClaimBalanceDto): Promise<{ hash: string }> {
    const claimantKeypair = StellarSdk.Keypair.fromSecret(dto.claimantSecretKey);
    const claimantAccount = await this.server.loadAccount(claimantKeypair.publicKey());
    const fee = await this.server.fetchBaseFee();

    const tx = new StellarSdk.TransactionBuilder(claimantAccount, {
      fee: String(fee),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.claimClaimableBalance({ balanceID: dto.balanceId }),
      )
      .setTimeout(30)
      .build();

    tx.sign(claimantKeypair);
    const result = await this.server.submitTransaction(tx);

    this.logger.log(`Balance claimed: id=${dto.balanceId} hash=${result.hash}`);
    return { hash: result.hash };
  }

  /**
   * Reclaims an expired balance back to the sponsor account.
   * The sponsor must be a claimant on the balance with an appropriate predicate.
   */
  async reclaimExpiredBalance(dto: ReclaimExpiredBalanceDto): Promise<{ hash: string }> {
    const sponsorKeypair = StellarSdk.Keypair.fromSecret(dto.sponsorSecretKey);
    const sponsorAccount = await this.server.loadAccount(sponsorKeypair.publicKey());
    const fee = await this.server.fetchBaseFee();

    const tx = new StellarSdk.TransactionBuilder(sponsorAccount, {
      fee: String(fee),
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.claimClaimableBalance({ balanceID: dto.balanceId }),
      )
      .setTimeout(30)
      .build();

    tx.sign(sponsorKeypair);
    const result = await this.server.submitTransaction(tx);

    this.logger.log(`Expired balance reclaimed: id=${dto.balanceId} hash=${result.hash}`);
    return { hash: result.hash };
  }

  private buildPredicate(
    type?: ClaimPredicateType,
    value?: number,
  ): StellarSdk.Claimant['predicate'] {
    switch (type) {
      case ClaimPredicateType.BEFORE_ABSOLUTE_TIME:
        if (value === undefined) throw new BadRequestException('predicateValue required for absolute time bound');
        return StellarSdk.Claimant.predicateBeforeAbsoluteTime(String(value));
      case ClaimPredicateType.BEFORE_RELATIVE_TIME:
        if (value === undefined) throw new BadRequestException('predicateValue required for relative time bound');
        return StellarSdk.Claimant.predicateBeforeRelativeTime(String(value));
      default:
        return StellarSdk.Claimant.predicateUnconditional();
    }
  }

  private extractBalanceId(result: any): string {
    // Horizon returns the balance_id in the result_xdr or we can compute it
    return result.balance_id ?? result.hash;
  }
}
