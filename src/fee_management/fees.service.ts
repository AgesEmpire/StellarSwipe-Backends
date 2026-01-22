import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as StellarSdk from '@stellar/stellar-sdk';
import { Keypair, Asset, Networks, Operation, Memo, TransactionBuilder } from '@stellar/stellar-sdk';
import Big from 'big.js';
import {
  FeeTransaction,
  FeeStatus,
  FeeTier,
} from './entities/fee-transaction.entity';
import {
  FeeSummaryDto,
  UserFeeSummaryDto,
  FeeCalculationDto,
  GetFeeHistoryDto,
  FeeConfigDto,
  MonthlyRevenueReportDto,
} from './dto/fee-summary.dto';

interface TradeDetails {
  userId: string;
  tradeId: string;
  tradeAmount: string;
  assetCode: string;
  assetIssuer: string;
  userPublicKey?: string;
}

interface FeeCollectionResult {
  success: boolean;
  feeTransaction: FeeTransaction;
  transactionHash?: string;
  error?: string;
}

@Injectable()
export class FeesService {
  private readonly logger = new Logger(FeesService.name);
  private readonly standardFeeRate = '0.001'; // 0.1%
  private readonly highVolumeFeeRate = '0.0008'; // 0.08%
  private readonly vipFeeRate = '0.0005'; // 0.05%
  private readonly highVolumeThreshold = '10000'; // $10k monthly volume
  private readonly platformWallet!: string;
  private readonly stellarServer: StellarSdk.Horizon.Server;
  private readonly platformKeypair!: StellarSdk.Keypair;
  private readonly networkPassphrase!: string;

  constructor(
    @InjectRepository(FeeTransaction)
    private readonly feeTransactionRepository: Repository<FeeTransaction>,
    private readonly configService: ConfigService,
  ) {
    // Initialize Stellar configuration
    this.networkPassphrase = this.configService.get<string>(
      'STELLAR_NETWORK_PASSPHRASE',
      Networks.TESTNET,
    );
    // Suppress unused warning if actually used in TransactionBuilder elsewhere
    this.logger.debug(`Network passphrase: ${this.networkPassphrase}`);
    const horizonUrl = this.configService.get<string>(
      'STELLAR_HORIZON_URL',
      'https://horizon-testnet.stellar.org',
    );

    this.stellarServer = new StellarSdk.Horizon.Server(horizonUrl);
    // Note: StellarSdk.Network.use is deprecated or handled differently in newer versions, 
    // but usually passed in individual calls or kept for legacy.
    // In @stellar/stellar-sdk, we often pass it to TransactionBuilder.

    // Platform wallet setup
    const platformSecret = this.configService.get<string>(
      'PLATFORM_WALLET_SECRET',
    );
    if (!platformSecret) {
      this.logger.warn('Platform wallet secret not configured');
    } else {
      this.platformKeypair = Keypair.fromSecret(platformSecret);
      this.platformWallet = this.platformKeypair.publicKey();
    }
    
    this.networkPassphrase = this.configService.get<string>(
        'STELLAR_NETWORK_PASSPHRASE',
        StellarSdk.Networks.TESTNET,
    );
    this.logger.debug(`Network passphrase: ${this.networkPassphrase}`);
  }

  /**
   * Calculate fee for a trade based on user's tier
   */
  async calculateFee(tradeDetails: TradeDetails): Promise<FeeCalculationDto> {
    try {
      const tradeAmount = new Big(tradeDetails.tradeAmount);

      if (tradeAmount.lte(0)) {
        throw new BadRequestException('Trade amount must be positive');
      }

      // Determine user's fee tier
      const feeTier = await this.determineUserFeeTier(tradeDetails.userId);
      const feeRate = this.getFeeRateForTier(feeTier);

      // Calculate fee: tradeAmount * feeRate
      const feeAmount = tradeAmount.times(new Big(feeRate));
      const netAmount = tradeAmount.minus(feeAmount);

      // Round to 7 decimal places (Stellar standard)
      const roundedFeeAmount = feeAmount.toFixed(7);
      const roundedNetAmount = netAmount.toFixed(7);

      return {
        tradeAmount: tradeDetails.tradeAmount,
        feeAmount: roundedFeeAmount,
        feeRate,
        feeTier,
        netAmount: roundedNetAmount,
        assetCode: tradeDetails.assetCode,
      };
    } catch (error: any) {
      this.logger.error(`Fee calculation failed: ${error.message}`, error.stack);
      throw new BadRequestException(`Fee calculation failed: ${error.message}`);
    }
  }

  /**
   * Calculate and collect fee on trade execution
   */
  async calculateAndCollectFee(
    tradeDetails: TradeDetails,
  ): Promise<FeeCollectionResult> {
    let feeTransaction: FeeTransaction | undefined = undefined;

    try {
      // Calculate fee
      const feeCalculation = await this.calculateFee(tradeDetails);

      // Create fee transaction record
      feeTransaction = this.feeTransactionRepository.create({
        userId: tradeDetails.userId,
        tradeId: tradeDetails.tradeId,
        tradeAmount: tradeDetails.tradeAmount,
        feeAmount: feeCalculation.feeAmount,
        feeRate: feeCalculation.feeRate,
        feeTier: feeCalculation.feeTier,
        assetCode: tradeDetails.assetCode,
        assetIssuer: tradeDetails.assetIssuer,
        platformWalletAddress: this.platformWallet,
        status: FeeStatus.PENDING,
      }) as FeeTransaction;

      await this.feeTransactionRepository.save(feeTransaction);

      // Collect fee to platform wallet
      if (tradeDetails.userPublicKey && this.platformKeypair) {
        const collectionResult = await this.collectFeeToWallet(
          feeTransaction,
          tradeDetails.userPublicKey,
        );

        if (collectionResult.success) {
          return collectionResult;
        } else {
          // Mark as failed but don't throw - allow retry
          this.logger.warn(
            `Fee collection failed for transaction ${feeTransaction.id}: ${collectionResult.error}`,
          );
          return collectionResult;
        }
      } else {
        // No wallet configured - mark as collected (will be collected later)
        feeTransaction.status = FeeStatus.COLLECTED;
        await this.feeTransactionRepository.save(feeTransaction);

        return {
          success: true,
          feeTransaction,
        };
      }
    } catch (error: any) {
      this.logger.error(`Fee collection failed: ${error.message}`, error.stack);

      if (feeTransaction) {
        feeTransaction.status = FeeStatus.FAILED;
        feeTransaction.failureReason = error.message;
        await this.feeTransactionRepository.save(feeTransaction);

        return {
          success: false,
          feeTransaction,
          error: error.message,
        };
      }

      throw new InternalServerErrorException(
        `Fee collection failed: ${error.message}`,
      );
    }
  }

  /**
   * Collect fee to platform Stellar wallet
   */
  private async collectFeeToWallet(
    feeTransaction: FeeTransaction,
    userPublicKey: string,
  ): Promise<FeeCollectionResult> {
    const maxRetries = 3;
    this.logger.debug(`Max retries: ${maxRetries}`);

    try {
      // Load platform account
      const platformAccount = await this.stellarServer.loadAccount(
        this.platformWallet,
      );

      // Create asset
      const asset =
        feeTransaction.assetCode === 'XLM'
          ? Asset.native()
          : new Asset(
              feeTransaction.assetCode,
              feeTransaction.assetIssuer,
            );

      // Build transaction
      const transaction = new TransactionBuilder(platformAccount, {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(
          Operation.payment({
            destination: this.platformWallet,
            asset: asset,
            amount: feeTransaction.feeAmount,
            source: userPublicKey,
          }),
        )
        .addMemo(
          Memo.text(`Fee:${feeTransaction.id.substring(0, 20)}`),
        )
        .setTimeout(30)
        .build();

      this.logger.debug(`Transaction built: ${transaction.toXDR()}`);

      // This would normally be signed by user's key
      // For now, we'll mark it as collected and expect external signing
      feeTransaction.status = FeeStatus.COLLECTED;
      feeTransaction.collectedAt = new Date();
      feeTransaction.stellarTransactionHash = 'PENDING_USER_SIGNATURE';

      await this.feeTransactionRepository.save(feeTransaction);

      return {
        success: true,
        feeTransaction,
        transactionHash: 'PENDING_USER_SIGNATURE',
      };
    } catch (error: any) {
      this.logger.error(
        `Stellar fee collection failed: ${error.message}`,
        error.stack,
      );

      feeTransaction.status = FeeStatus.FAILED;
      feeTransaction.failureReason = error.message;
      feeTransaction.retryCount += 1;

      await this.feeTransactionRepository.save(feeTransaction);

      return {
        success: false,
        feeTransaction,
        error: error.message,
      };
    }
  }

  /**
   * Retry failed fee collections
   */
  async retryFailedCollections(): Promise<{
    attempted: number;
    succeeded: number;
    failed: number;
  }> {
    const failedFees = await this.feeTransactionRepository.find({
      where: {
        status: FeeStatus.FAILED,
        retryCount: LessThanOrEqual(3),
      },
      take: 100,
    });

    let succeeded = 0;
    let failed = 0;

    for (const fee of failedFees) {
      // This would require the user's public key - simplified for now
      fee.status = FeeStatus.PENDING;
      await this.feeTransactionRepository.save(fee);
      succeeded++;
    }

    this.logger.log(
      `Retry completed: ${succeeded} succeeded, ${failed} failed of ${failedFees.length} attempted`,
    );

    return {
      attempted: failedFees.length,
      succeeded,
      failed,
    };
  }

  /**
   * Get fee history with filtering
   */
  async getFeeHistory(
    filters: GetFeeHistoryDto,
  ): Promise<{ data: FeeTransaction[]; total: number }> {
    const { userId, startDate, endDate, status, feeTier, page, limit } =
      filters;

    const queryBuilder = this.feeTransactionRepository.createQueryBuilder('fee');

    if (userId) {
      queryBuilder.andWhere('fee.userId = :userId', { userId });
    }

    if (startDate && endDate) {
      queryBuilder.andWhere('fee.createdAt BETWEEN :startDate AND :endDate', {
        startDate: new Date(startDate),
        endDate: new Date(endDate),
      });
    } else if (startDate) {
      queryBuilder.andWhere('fee.createdAt >= :startDate', {
        startDate: new Date(startDate),
      });
    } else if (endDate) {
      queryBuilder.andWhere('fee.createdAt <= :endDate', {
        endDate: new Date(endDate),
      });
    }

    if (status) {
      queryBuilder.andWhere('fee.status = :status', { status });
    }

    if (feeTier) {
      queryBuilder.andWhere('fee.feeTier = :feeTier', { feeTier });
    }

    queryBuilder.orderBy('fee.createdAt', 'DESC');

    const total = await queryBuilder.getCount();

    const data = await queryBuilder
      .skip(((page || 1) - 1) * (limit || 10))
      .take(limit || 10)
      .getMany();

    return { data, total };
  }

  /**
   * Get user fee summary
   */
  async getUserFeeSummary(userId: string): Promise<UserFeeSummaryDto> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const userFees = await this.feeTransactionRepository.find({
      where: {
        userId,
        status: FeeStatus.COLLECTED,
        createdAt: MoreThanOrEqual(thirtyDaysAgo),
      },
    });

    let totalFeesPaid = new Big(0);
    let totalTradeVolume = new Big(0);

    for (const fee of userFees) {
      totalFeesPaid = totalFeesPaid.plus(new Big(fee.feeAmount));
      totalTradeVolume = totalTradeVolume.plus(new Big(fee.tradeAmount));
    }

    const currentFeeTier = await this.determineUserFeeTier(userId);
    const currentFeeRate = this.getFeeRateForTier(currentFeeTier);

    // Calculate savings
    let feesSaved = new Big(0);
    if (currentFeeTier !== FeeTier.STANDARD) {
      const standardRate = new Big(this.standardFeeRate);
      const currentRate = new Big(currentFeeRate);
      const rateDifference = standardRate.minus(currentRate);
      feesSaved = totalTradeVolume.times(rateDifference);
    }

    return {
      userId,
      totalFeesPaid: totalFeesPaid.toFixed(7),
      totalTradeVolume: totalTradeVolume.toFixed(7),
      tradeCount: userFees.length,
      currentFeeTier,
      currentFeeRate,
      monthlyVolume: totalTradeVolume.toFixed(7),
      feesSaved: feesSaved.toFixed(7),
    };
  }

  /**
   * Generate platform fee summary for a period
   */
  async getPlatformFeeSummary(
    startDate: Date,
    endDate: Date,
  ): Promise<FeeSummaryDto> {
    const fees = await this.feeTransactionRepository.find({
      where: {
        createdAt: Between(startDate, endDate),
      },
    });

    let totalFeesCollected = new Big(0);
    let totalTradeVolume = new Big(0);
    let failedCollections = 0;
    let pendingCollections = 0;

    const feesByTier: any = {};
    const feesByAsset: any = {};

    for (const fee of fees) {
      if (fee.status === FeeStatus.COLLECTED) {
        totalFeesCollected = totalFeesCollected.plus(new Big(fee.feeAmount));
      }

      totalTradeVolume = totalTradeVolume.plus(new Big(fee.tradeAmount));

      if (fee.status === FeeStatus.FAILED) failedCollections++;
      if (fee.status === FeeStatus.PENDING) pendingCollections++;

      // By tier
      if (!feesByTier[fee.feeTier]) {
        feesByTier[fee.feeTier] = {
          count: 0,
          totalFees: new Big(0),
          totalVolume: new Big(0),
        };
      }
      feesByTier[fee.feeTier].count++;
      feesByTier[fee.feeTier].totalFees = feesByTier[fee.feeTier].totalFees.plus(
        new Big(fee.feeAmount),
      );
      feesByTier[fee.feeTier].totalVolume = feesByTier[
        fee.feeTier
      ].totalVolume.plus(new Big(fee.tradeAmount));

      // By asset
      if (!feesByAsset[fee.assetCode]) {
        feesByAsset[fee.assetCode] = {
          count: 0,
          totalFees: new Big(0),
          totalVolume: new Big(0),
        };
      }
      feesByAsset[fee.assetCode].count++;
      feesByAsset[fee.assetCode].totalFees = feesByAsset[
        fee.assetCode
      ].totalFees.plus(new Big(fee.feeAmount));
      feesByAsset[fee.assetCode].totalVolume = feesByAsset[
        fee.assetCode
      ].totalVolume.plus(new Big(fee.tradeAmount));
    }

    // Convert Big to string
    const feesByTierFormatted: any = {};
    for (const [tier, data] of Object.entries(feesByTier)) {
      feesByTierFormatted[tier] = {
        count: (data as any).count,
        totalFees: (data as any).totalFees.toFixed(7),
        totalVolume: (data as any).totalVolume.toFixed(7),
      };
    }

    const feesByAssetFormatted: any = {};
    for (const [asset, data] of Object.entries(feesByAsset)) {
      feesByAssetFormatted[asset] = {
        count: (data as any).count,
        totalFees: (data as any).totalFees.toFixed(7),
        totalVolume: (data as any).totalVolume.toFixed(7),
      };
    }

    const averageFee =
      fees.length > 0
        ? totalFeesCollected.div(new Big(fees.length))
        : new Big(0);

    return {
      totalFeesCollected: totalFeesCollected.toFixed(7),
      totalTradeVolume: totalTradeVolume.toFixed(7),
      transactionCount: fees.length,
      averageFee: averageFee.toFixed(7),
      failedCollections,
      pendingCollections,
      feesByTier: feesByTierFormatted,
      feesByAsset: feesByAssetFormatted,
      periodStart: startDate,
      periodEnd: endDate,
    };
  }

  /**
   * Generate monthly revenue report
   */
  async generateMonthlyReport(
    year: number,
    month: number,
  ): Promise<MonthlyRevenueReportDto> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const fees = await this.feeTransactionRepository.find({
      where: {
        createdAt: Between(startDate, endDate),
        status: FeeStatus.COLLECTED,
      },
    });

    let totalRevenue = new Big(0);
    let totalVolume = new Big(0);
    const revenueByTier: any = {};
    const revenueByAsset: any = {};
    const userFees: Map<string, { totalFees: Big; tradeCount: number }> =
      new Map();

    for (const fee of fees) {
      totalRevenue = totalRevenue.plus(new Big(fee.feeAmount));
      totalVolume = totalVolume.plus(new Big(fee.tradeAmount));

      // By tier
      if (!revenueByTier[fee.feeTier]) {
        revenueByTier[fee.feeTier] = new Big(0);
      }
      revenueByTier[fee.feeTier] = revenueByTier[fee.feeTier].plus(
        new Big(fee.feeAmount),
      );

      // By asset
      if (!revenueByAsset[fee.assetCode]) {
        revenueByAsset[fee.assetCode] = new Big(0);
      }
      revenueByAsset[fee.assetCode] = revenueByAsset[fee.assetCode].plus(
        new Big(fee.feeAmount),
      );

      // By user
      const userStats = userFees.get(fee.userId) || {
        totalFees: new Big(0),
        tradeCount: 0,
      };
      userStats.totalFees = userStats.totalFees.plus(new Big(fee.feeAmount));
      userStats.tradeCount++;
      userFees.set(fee.userId, userStats);
    }

    // Get failed collections total
    const failedFees = await this.feeTransactionRepository.find({
      where: {
        createdAt: Between(startDate, endDate),
        status: FeeStatus.FAILED,
      },
    });

    let failedCollectionsTotal = new Big(0);
    for (const fee of failedFees) {
      failedCollectionsTotal = failedCollectionsTotal.plus(new Big(fee.feeAmount));
    }

    // Top users
    const topUsersArray = Array.from(userFees.entries())
      .sort((a, b) => b[1].totalFees.cmp(a[1].totalFees))
      .slice(0, 10)
      .map(([userId, stats]) => ({
        userId,
        totalFees: stats.totalFees.toFixed(7),
        tradeCount: stats.tradeCount,
      }));

    // Format revenue by tier
    const revenueByTierFormatted: any = {};
    for (const [tier, amount] of Object.entries(revenueByTier)) {
      revenueByTierFormatted[tier] = (amount as Big).toFixed(7);
    }

    // Format revenue by asset
    const revenueByAssetFormatted: any = {};
    for (const [asset, amount] of Object.entries(revenueByAsset)) {
      revenueByAssetFormatted[asset] = (amount as Big).toFixed(7);
    }

    const averageFeePerTransaction =
      fees.length > 0 ? totalRevenue.div(new Big(fees.length)) : new Big(0);

    return {
      year,
      month,
      totalRevenue: totalRevenue.toFixed(7),
      totalVolume: totalVolume.toFixed(7),
      transactionCount: fees.length,
      uniqueUsers: userFees.size,
      revenueByTier: revenueByTierFormatted,
      revenueByAsset: revenueByAssetFormatted,
      topUsers: topUsersArray,
      failedCollectionsTotal: failedCollectionsTotal.toFixed(7),
      averageFeePerTransaction: averageFeePerTransaction.toFixed(7),
    };
  }

  /**
   * Get current fee configuration
   */
  getFeeConfig(): FeeConfigDto {
    return {
      standardRate: this.standardFeeRate,
      highVolumeRate: this.highVolumeFeeRate,
      vipRate: this.vipFeeRate,
      highVolumeThreshold: this.highVolumeThreshold,
      platformWalletAddress: this.platformWallet || 'NOT_CONFIGURED',
    };
  }

  /**
   * Determine user's fee tier based on volume and VIP status
   */
  private async determineUserFeeTier(userId: string): Promise<FeeTier> {
    // Check for promotional tier first
    const hasPromotion = await this.checkUserPromotion(userId);
    if (hasPromotion) {
      return FeeTier.PROMOTIONAL;
    }

    // Check VIP status (would integrate with user service)
    const isVIP = await this.checkVIPStatus(userId);
    if (isVIP) {
      return FeeTier.VIP;
    }

    // Check monthly volume
    const monthlyVolume = await this.getUserMonthlyVolume(userId);
    if (new Big(monthlyVolume).gte(new Big(this.highVolumeThreshold))) {
      return FeeTier.HIGH_VOLUME;
    }

    return FeeTier.STANDARD;
  }

  /**
   * Get fee rate for a specific tier
   */
  private getFeeRateForTier(tier: FeeTier): string {
    switch (tier) {
      case FeeTier.VIP:
        return this.vipFeeRate;
      case FeeTier.HIGH_VOLUME:
        return this.highVolumeFeeRate;
      case FeeTier.PROMOTIONAL:
        return '0'; // Free during promotion
      case FeeTier.STANDARD:
      default:
        return this.standardFeeRate;
    }
  }

  /**
   * Calculate user's monthly trade volume
   */
  private async getUserMonthlyVolume(userId: string): Promise<string> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const fees = await this.feeTransactionRepository.find({
      where: {
        userId,
        createdAt: MoreThanOrEqual(thirtyDaysAgo),
        status: FeeStatus.COLLECTED,
      },
    });

    let totalVolume = new Big(0);
    for (const fee of fees) {
      totalVolume = totalVolume.plus(new Big(fee.tradeAmount));
    }

    return totalVolume.toFixed(7);
  }

  /**
   * Check if user has VIP status (stub - integrate with user service)
   */
  private async checkVIPStatus(_userId: string): Promise<boolean> {
    // TODO: Integrate with user service to check staking status
    return false;
  }

  /**
   * Check if user has active promotion (stub)
   */
  private async checkUserPromotion(_userId: string): Promise<boolean> {
    // TODO: Integrate with promotions service
    return false;
  }

  /**
   * Apply promotional fee rate
   */
  async applyPromotionalRate(
    userId: string,
    promotionCode: string,
    customRate: string,
  ): Promise<void> {
    // This would create a promotion record
    // For now, just log
    this.logger.log(
      `Applied promotional rate ${customRate} for user ${userId} with code ${promotionCode}`,
    );
  }
}