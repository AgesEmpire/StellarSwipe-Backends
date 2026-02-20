import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Asset, Networks } from '@stellar/stellar-sdk';
import Big from 'big.js';

/**
 * Result of verifying a Stellar payment transaction.
 */
export interface PaymentVerificationResult {
  valid: boolean;
  amount: string;
  assetCode: string;
  assetIssuer: string | null;
  sender: string;
  receiver: string;
  memo?: string;
  error?: string;
}

/**
 * Platform commission: 20% of the subscription price.
 */
export const PLATFORM_COMMISSION_RATE = new Big('0.20');

/**
 * USDC asset codes and issuer addresses on testnet / mainnet.
 */
const USDC_TESTNET_ISSUER = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5';
const USDC_MAINNET_ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';

@Injectable()
export class PaymentProcessorService {
  private readonly logger = new Logger(PaymentProcessorService.name);
  private readonly horizonServer: StellarSdk.Horizon.Server;
  private readonly usdcIssuer: string;
  private readonly platformWallet: string;

  constructor(private readonly configService: ConfigService) {
    const network = this.configService.get<string>('STELLAR_NETWORK', 'testnet');
    const horizonUrl = this.configService.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );

    // networkPassphrase retained for future transaction building
    const _networkPassphrase =
      this.configService.get<string>('STELLAR_NETWORK_PASSPHRASE') ||
      (network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET);
    void _networkPassphrase;

    this.usdcIssuer =
      this.configService.get<string>('USDC_ISSUER_ADDRESS') ||
      (network === 'mainnet' ? USDC_MAINNET_ISSUER : USDC_TESTNET_ISSUER);

    this.platformWallet =
      this.configService.get<string>('PLATFORM_WALLET_ADDRESS') || '';

    this.horizonServer = new StellarSdk.Horizon.Server(horizonUrl);

    if (!this.platformWallet) {
      this.logger.warn('PLATFORM_WALLET_ADDRESS is not configured');
    }
  }

  /**
   * Verify that a Stellar transaction actually transferred the expected USDC
   * amount from the subscriber to the provider (or platform escrow wallet).
   */
  async verifySubscriptionPayment(
    txHash: string,
    expectedAmountUsdc: string,
    senderWallet: string,
    receiverWallet: string,
  ): Promise<PaymentVerificationResult> {
    this.logger.log(`Verifying subscription payment: txHash=${txHash}`);

    try {
      const tx = await this.horizonServer
        .transactions()
        .transaction(txHash)
        .call();

      if (!tx) {
        return {
          valid: false,
          amount: '0',
          assetCode: '',
          assetIssuer: null,
          sender: '',
          receiver: '',
          error: 'Transaction not found on Stellar network',
        };
      }

      // Fetch the operations for this transaction
      const ops = await this.horizonServer
        .operations()
        .forTransaction(txHash)
        .call();

      // Find a payment operation matching our criteria
      for (const op of ops.records) {
        if (op.type !== 'payment') continue;

        const payOp = op as StellarSdk.Horizon.ServerApi.PaymentOperationRecord;

        // Check that this is a USDC payment
        const isUsdc =
          payOp.asset_type === 'credit_alphanum4' &&
          payOp.asset_code === 'USDC' &&
          payOp.asset_issuer === this.usdcIssuer;

        if (!isUsdc) continue;

        // Verify sender and receiver
        const senderMatch =
          payOp.from.toLowerCase() === senderWallet.toLowerCase();
        const receiverMatch =
          payOp.to.toLowerCase() === receiverWallet.toLowerCase();

        if (!senderMatch || !receiverMatch) continue;

        // Verify amount (allow small tolerance for rounding)
        const paidAmount = new Big(payOp.amount);
        const expectedAmount = new Big(expectedAmountUsdc);
        const tolerance = new Big('0.0000001');

        if (paidAmount.gte(expectedAmount.minus(tolerance))) {
          this.logger.log(
            `Payment verified: ${payOp.amount} USDC from ${senderWallet} to ${receiverWallet}`,
          );
          return {
            valid: true,
            amount: payOp.amount,
            assetCode: 'USDC',
            assetIssuer: payOp.asset_issuer ?? null,
            sender: payOp.from,
            receiver: payOp.to,
          };
        }

        return {
          valid: false,
          amount: payOp.amount,
          assetCode: 'USDC',
          assetIssuer: payOp.asset_issuer ?? null,
          sender: payOp.from,
          receiver: payOp.to,
          error: `Insufficient payment: expected ${expectedAmountUsdc} USDC, got ${payOp.amount} USDC`,
        };
      }

      return {
        valid: false,
        amount: '0',
        assetCode: '',
        assetIssuer: null,
        sender: '',
        receiver: '',
        error: 'No matching USDC payment operation found in transaction',
      };
    } catch (error: any) {
      this.logger.error(`Payment verification failed: ${error.message}`, error.stack);
      return {
        valid: false,
        amount: '0',
        assetCode: '',
        assetIssuer: null,
        sender: '',
        receiver: '',
        error: `Stellar network error: ${error.message}`,
      };
    }
  }

  /**
   * Calculate the split between platform commission and provider earnings.
   */
  calculateRevenueSplit(grossAmountUsdc: string): {
    platformCommission: string;
    providerEarnings: string;
  } {
    const gross = new Big(grossAmountUsdc);
    const commission = gross.times(PLATFORM_COMMISSION_RATE).toFixed(7);
    const providerEarnings = gross.minus(new Big(commission)).toFixed(7);
    return { platformCommission: commission, providerEarnings };
  }

  /**
   * Build a human-readable memo for a subscription payment so the provider
   * can identify the incoming transfer.
   */
  buildPaymentMemo(tierId: string): string {
    return `SUB:${tierId.substring(0, 22)}`;
  }

  /**
   * Return the USDC asset object for transaction building.
   */
  getUsdcAsset(): Asset {
    return new Asset('USDC', this.usdcIssuer);
  }

  get platformWalletAddress(): string {
    return this.platformWallet;
  }

  get usdcIssuerAddress(): string {
    return this.usdcIssuer;
  }
}
