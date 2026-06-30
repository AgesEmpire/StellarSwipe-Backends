import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as StellarSdk from '@stellar/stellar-sdk';
import { ConfigService } from '@nestjs/config';
import { FeeBumpDto, FeeBumpResultDto } from './fee-bump.dto';

@Injectable()
export class FeeBumpService {
  private readonly logger = new Logger(FeeBumpService.name);
  private readonly server: StellarSdk.Horizon.Server;
  private readonly sponsorKeypair: StellarSdk.Keypair;
  private readonly networkPassphrase: string;

  /** Tracks cumulative fees spent by the sponsor for cost monitoring. */
  private totalFeesSpent = BigInt(0);

  constructor(private readonly configService: ConfigService) {
    const horizonUrl = this.configService.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );
    this.server = new StellarSdk.Horizon.Server(horizonUrl);

    const secret = this.configService.getOrThrow<string>('STELLAR_SPONSOR_SECRET_KEY');
    this.sponsorKeypair = StellarSdk.Keypair.fromSecret(secret);

    this.networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK') === 'mainnet'
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET;
  }

  /**
   * Wraps a user-signed inner transaction in a fee-bump envelope,
   * signs it with the sponsor account, and submits to Horizon.
   */
  async submitFeeBump(dto: FeeBumpDto): Promise<FeeBumpResultDto> {
    let innerTx: StellarSdk.Transaction;
    try {
      innerTx = new StellarSdk.Transaction(dto.innerTransactionXdr, this.networkPassphrase);
    } catch {
      throw new BadRequestException('Invalid inner transaction XDR');
    }

    // Reject already-fee-bumped transactions
    if (innerTx instanceof StellarSdk.FeeBumpTransaction) {
      throw new BadRequestException('Inner transaction must not be a fee-bump transaction');
    }

    const baseFee = await this.server.fetchBaseFee();
    const feePerOp = dto.feePerOperation
      ? parseInt(dto.feePerOperation, 10)
      : baseFee * 10;

    const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      this.sponsorKeypair,
      String(feePerOp),
      innerTx,
      this.networkPassphrase,
    );

    feeBumpTx.sign(this.sponsorKeypair);

    const result = await this.server.submitTransaction(feeBumpTx);

    const feeCharged = (result as any).fee_charged ?? String(feePerOp);
    this.totalFeesSpent += BigInt(feeCharged);

    this.logger.log(
      `Fee-bump submitted: hash=${result.hash} sponsor=${this.sponsorKeypair.publicKey()} fee=${feeCharged} totalSpent=${this.totalFeesSpent}`,
    );

    return {
      hash: result.hash,
      sponsorAccount: this.sponsorKeypair.publicKey(),
      feeCharged,
    };
  }

  /** Returns cumulative fees spent by the sponsor (in stroops). */
  getSponsorFeeStats(): { sponsorAccount: string; totalFeesSpentStroops: string } {
    return {
      sponsorAccount: this.sponsorKeypair.publicKey(),
      totalFeesSpentStroops: this.totalFeesSpent.toString(),
    };
  }
}
