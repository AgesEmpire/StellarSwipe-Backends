import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Request,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { RevenueShareService } from './revenue-share/revenue-share.service';
import { TierManagerService } from './revenue-share/tier-manager.service';
import {
  ProviderTierLevel,
  BonusType,
} from './revenue-share/entities/revenue-share-tier.entity';
import { ProviderMuteService } from './mute/provider-mute.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

// ─── Request types (inline – avoids extra dto files) ───────────────────────

class CalculateRevenueShareDto {
  baseRevenue!: string;
  includeBonus?: boolean;
}

class ProcessPayoutDto {
  baseRevenue!: string;
  includeBonus?: boolean;
  periodYear?: number;
  periodMonth?: number;
}

class AwardBonusDto {
  bonusAmountUsdc!: string;
  bonusType!: BonusType;
  reason?: string;
}

class ConfirmPayoutDto {
  stellarTxHash!: string;
}

class FailPayoutDto {
  reason!: string;
}

class UpdateTierConfigDto {
  revenueSharePercentage?: string;
  minWinRate?: string;
  minSignals?: number;
  minCopiers?: number;
  performanceBonusUsdc?: string;
  monthlyRetentionBonusUsdc?: string;
  isActive?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Controller
// ─────────────────────────────────────────────────────────────────────────────

@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly revenueShareService: RevenueShareService,
    private readonly tierManagerService: TierManagerService,
    private readonly providerMuteService: ProviderMuteService,
  ) {}

  // ── Tier information ──────────────────────────────────────────────────────

  /**
   * GET /providers/tiers
   * Returns all tier definitions with current provider counts.
   */
  @Get('tiers')
  async getTierSummaries() {
    return this.tierManagerService.getTierSummaries();
  }

  /**
   * GET /providers/tiers/config
   * Returns raw tier configuration rows (admin use).
   */
  @Get('tiers/config')
  async getTierConfigs() {
    return this.tierManagerService.getAllTierConfigs();
  }

  /**
   * PATCH /providers/tiers/config/:tierLevel
   * Update threshold / bonus parameters for a specific tier.
   */
  @Patch('tiers/config/:tierLevel')
  async updateTierConfig(
    @Param('tierLevel') tierLevel: ProviderTierLevel,
    @Body() dto: UpdateTierConfigDto,
  ) {
    return this.tierManagerService.updateTierConfig(tierLevel, dto);
  }

  // ── Provider tier status ──────────────────────────────────────────────────

  /**
   * GET /providers/:providerId/tier
   * Returns the current tier assignment for a provider.
   */
  @Get(':providerId/tier')
  async getProviderTier(
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ) {
    return this.tierManagerService.getProviderTier(providerId);
  }

  /**
   * POST /providers/:providerId/tier/evaluate
   * Force a tier re-evaluation for a single provider.
   */
  @Post(':providerId/tier/evaluate')
  @HttpCode(HttpStatus.OK)
  async evaluateProvider(
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ) {
    return this.tierManagerService.evaluateProvider(providerId);
  }

  /**
   * POST /providers/tier/evaluate-all
   * Batch re-evaluate tiers for all providers (admin / scheduler trigger).
   */
  @Post('tier/evaluate-all')
  @HttpCode(HttpStatus.OK)
  async evaluateAllProviders() {
    return this.tierManagerService.evaluateAllProviders();
  }

  // ── Revenue share ─────────────────────────────────────────────────────────

  /**
   * POST /providers/:providerId/revenue-share/calculate
   * Preview the revenue share calculation (does NOT persist).
   */
  @Post(':providerId/revenue-share/calculate')
  @HttpCode(HttpStatus.OK)
  async calculateRevenueShare(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Body() dto: CalculateRevenueShareDto,
  ) {
    return this.revenueShareService.calculateRevenueShare(
      providerId,
      dto.baseRevenue,
      dto.includeBonus,
    );
  }

  /**
   * POST /providers/:providerId/revenue-share/payout
   * Trigger a revenue-share payout for a provider.
   */
  @Post(':providerId/revenue-share/payout')
  async processProviderPayout(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Body() dto: ProcessPayoutDto,
  ) {
    return this.revenueShareService.processProviderPayout(
      providerId,
      dto.baseRevenue,
      {
        includeBonus: dto.includeBonus,
        periodYear: dto.periodYear,
        periodMonth: dto.periodMonth,
      },
    );
  }

  /**
   * GET /providers/:providerId/revenue-share/history
   * Paginated payout history for a provider.
   */
  @Get(':providerId/revenue-share/history')
  async getPayoutHistory(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.revenueShareService.getProviderPayoutHistory(
      providerId,
      parseInt(page, 10),
      parseInt(limit, 10),
    );
  }

  /**
   * GET /providers/:providerId/revenue-share/summary
   * Aggregated earnings summary for a provider.
   */
  @Get(':providerId/revenue-share/summary')
  async getEarningsSummary(
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ) {
    return this.revenueShareService.getProviderEarningsSummary(providerId);
  }

  // ── Bonuses ───────────────────────────────────────────────────────────────

  /**
   * POST /providers/:providerId/bonus
   * Manually award a performance bonus.
   */
  @Post(':providerId/bonus')
  async awardBonus(
    @Param('providerId', ParseUUIDPipe) providerId: string,
    @Body() dto: AwardBonusDto,
  ) {
    return this.revenueShareService.awardPerformanceBonus(
      providerId,
      dto.bonusAmountUsdc,
      dto.bonusType,
      dto.reason,
    );
  }

  /**
   * POST /providers/:providerId/bonus/streak-check
   * Check win-streak and auto-issue bonus if threshold is met.
   */
  @Post(':providerId/bonus/streak-check')
  @HttpCode(HttpStatus.OK)
  async checkStreakBonus(
    @Param('providerId', ParseUUIDPipe) providerId: string,
  ) {
    return this.revenueShareService.checkAndIssueStreakBonus(providerId);
  }

  // ── Payout lifecycle (admin / finance) ───────────────────────────────────

  /**
   * GET /providers/payouts/pending
   * List payouts awaiting on-chain dispatch.
   */
  @Get('payouts/pending')
  async getPendingPayouts(@Query('limit') limit = '50') {
    return this.revenueShareService.getPendingPayouts(parseInt(limit, 10));
  }

  /**
   * PATCH /providers/payouts/:payoutId/confirm
   * Mark a payout as completed after Stellar confirmation.
   */
  @Patch('payouts/:payoutId/confirm')
  async confirmPayout(
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
    @Body() dto: ConfirmPayoutDto,
  ) {
    return this.revenueShareService.confirmPayout(payoutId, dto.stellarTxHash);
  }

  /**
   * PATCH /providers/payouts/:payoutId/fail
   * Mark a payout as failed.
   */
  @Patch('payouts/:payoutId/fail')
  async failPayout(
    @Param('payoutId', ParseUUIDPipe) payoutId: string,
    @Body() dto: FailPayoutDto,
  ) {
    return this.revenueShareService.markPayoutFailed(payoutId, dto.reason);
  }

  /**
   * POST /providers/payouts/:payoutId/retry
   * Requeue a failed payout.
   */
  @Post('payouts/:payoutId/retry')
  @HttpCode(HttpStatus.OK)
  async retryPayout(@Param('payoutId', ParseUUIDPipe) payoutId: string) {
    return this.revenueShareService.retryFailedPayout(payoutId);
  }

  /**
   * GET /providers/payouts/period
   * Retrieve all payouts for a billing period.
   */
  @Get('payouts/period')
  async getPeriodPayouts(
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    return this.revenueShareService.getPeriodPayouts(
      parseInt(year, 10),
      parseInt(month, 10),
    );
  }

  // ── Incentive programs ─────────────────────────────────────────────────────

  /**
   * POST /providers/incentives/retention-bonus
   * Trigger the monthly retention bonus round for Elite/Platinum providers.
   */
  @Post('incentives/retention-bonus')
  @HttpCode(HttpStatus.OK)
  async runRetentionBonusRound(
    @Query('year') year: string,
    @Query('month') month: string,
  ) {
    const now = new Date();
    return this.revenueShareService.runRetentionBonusRound(
      year ? parseInt(year, 10) : now.getFullYear(),
      month ? parseInt(month, 10) : now.getMonth() + 1,
    );
  }

  // ── Mute / Unmute ──────────────────────────────────────────────────────────

  @Post(':id/mute')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async muteProvider(
    @Param('id', ParseUUIDPipe) providerId: string,
    @Request() req: any,
  ): Promise<void> {
    await this.providerMuteService.mute(req.user.userId, providerId);
  }

  @Post(':id/unmute')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async unmuteProvider(
    @Param('id', ParseUUIDPipe) providerId: string,
    @Request() req: any,
  ): Promise<void> {
    await this.providerMuteService.unmute(req.user.userId, providerId);
  }

  @Get(':id/mute-status')
  @UseGuards(JwtAuthGuard)
  async getMuteStatus(
    @Param('id', ParseUUIDPipe) providerId: string,
    @Request() req: any,
  ): Promise<{ muted: boolean }> {
    const muted = await this.providerMuteService.isMuted(req.user.userId, providerId);
    return { muted };
  }
}
