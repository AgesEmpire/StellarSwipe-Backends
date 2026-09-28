import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, KycStatus } from '../../users/entities/user.entity';
import { AmlMonitoringService } from '../aml/aml-monitoring.service';
import { GeoBlockService } from '../geo-blocking/geo-block.service';
import {
  ITradeEligibilityRule,
  RuleResult,
  TradeEligibilityContext,
} from './interfaces/trade-eligibility-rule.interface';
import { KycStatusRule } from './rules/kyc-status.rule';
import { GeographicRestrictionRule } from './rules/geographic-restriction.rule';
import { AmlStatusRule } from './rules/aml-status.rule';
import { AssetClassRestrictionRule } from './rules/asset-class-restriction.rule';
import { TransactionLimitRule } from './rules/transaction-limit.rule';
import {
  TradeEligibilityDecision,
  EligibilityDecisionOutcome,
} from './entities/trade-eligibility-decision.entity';
import { TradeEligibilityResultDto } from './dto/evaluate-trade.dto';

export interface EvaluationInput {
  userId: string;
  amount: number;
  asset: string;
  counterAsset?: string;
  ipAddress?: string;
}

/**
 * Central compliance rule engine.
 *
 * Responsibilities:
 *  1. Enrich the evaluation context (load user, resolve geo, check AML flags).
 *  2. Run every registered rule in sequence.
 *  3. Persist an immutable audit record of the decision.
 *  4. Return a structured result — or throw ForbiddenException when rejected.
 */
@Injectable()
export class ComplianceRuleEngineService {
  private readonly logger = new Logger(ComplianceRuleEngineService.name);

  /** Ordered list of rules evaluated for every trade. */
  private readonly rules: ITradeEligibilityRule[];

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(TradeEligibilityDecision)
    private readonly decisionRepository: Repository<TradeEligibilityDecision>,
    private readonly amlMonitoringService: AmlMonitoringService,
    private readonly geoBlockService: GeoBlockService,
    // Individual rules injected so they can be unit-tested independently
    private readonly kycStatusRule: KycStatusRule,
    private readonly geographicRestrictionRule: GeographicRestrictionRule,
    private readonly amlStatusRule: AmlStatusRule,
    private readonly assetClassRestrictionRule: AssetClassRestrictionRule,
    private readonly transactionLimitRule: TransactionLimitRule,
  ) {
    this.rules = [
      this.kycStatusRule,
      this.geographicRestrictionRule,
      this.amlStatusRule,
      this.assetClassRestrictionRule,
      this.transactionLimitRule,
    ];
  }

  /**
   * Evaluate trade eligibility and persist the decision.
   *
   * @throws BadRequestException  when the user is not found.
   * @throws ForbiddenException   when one or more rules reject the trade.
   */
  async evaluateTrade(
    input: EvaluationInput,
  ): Promise<TradeEligibilityResultDto> {
    const { userId, amount, asset, counterAsset, ipAddress } = input;

    // ── 1. Load user ──────────────────────────────────────────────────────────
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException(`User ${userId} not found.`);
    }

    // ── 2. Resolve geo location ───────────────────────────────────────────────
    let countryCode: string | undefined;
    if (ipAddress) {
      try {
        const geo = await this.geoBlockService.getGeoLocation(ipAddress);
        countryCode = geo.countryCode !== 'XX' ? geo.countryCode : undefined;
      } catch {
        // Geo lookup failure is non-fatal; geographic rule will skip.
        this.logger.warn(`Geo lookup failed for IP ${ipAddress}`);
      }
    }

    // ── 3. Check AML flags ────────────────────────────────────────────────────
    let hasAmlFlags = false;
    try {
      const riskScore =
        await this.amlMonitoringService.getUserRiskScore(userId);
      hasAmlFlags = riskScore > 0;
    } catch {
      // AML service failure is non-fatal; AML rule will rely on amount threshold.
      this.logger.warn(`AML risk score lookup failed for user ${userId}`);
    }

    // ── 4. Build context ──────────────────────────────────────────────────────
    const context: TradeEligibilityContext = {
      userId,
      amount,
      asset,
      counterAsset,
      ipAddress,
      countryCode,
      kycStatus: user.kycStatus,
      userTier: user.tier,
      hasAmlFlags,
    };

    // ── 5. Run all rules ──────────────────────────────────────────────────────
    const ruleResults: RuleResult[] = await Promise.all(
      this.rules.map((rule) =>
        rule.evaluate(context).catch((err) => {
          // A rule that throws is treated as a failure to be safe.
          this.logger.error(
            `Rule ${rule.ruleId} threw unexpectedly: ${err.message}`,
          );
          return {
            ruleId: rule.ruleId,
            ruleName: rule.ruleName,
            passed: false,
            reason: `Internal rule evaluation error: ${err.message}`,
          } as RuleResult;
        }),
      ),
    );

    const failedResults = ruleResults.filter((r) => !r.passed);
    const eligible = failedResults.length === 0;
    const outcome = eligible
      ? EligibilityDecisionOutcome.APPROVED
      : EligibilityDecisionOutcome.REJECTED;

    // ── 6. Persist audit record ───────────────────────────────────────────────
    const decision = await this.persistDecision({
      userId,
      asset,
      counterAsset,
      amount,
      outcome,
      failedResults,
      ruleResults,
      ipAddress,
      countryCode,
    });

    this.logger.log(
      `Trade eligibility [${outcome.toUpperCase()}] for user=${userId} ` +
        `asset=${asset} amount=${amount} decisionId=${decision.id}`,
    );

    // ── 7. Build result DTO ───────────────────────────────────────────────────
    const result: TradeEligibilityResultDto = {
      eligible,
      outcome,
      reasons: failedResults.map((r) => r.reason ?? ''),
      ruleResults: ruleResults.map((r) => ({
        ruleId: r.ruleId,
        ruleName: r.ruleName,
        passed: r.passed,
        reason: r.reason,
      })),
      decisionId: decision.id,
    };

    if (!eligible) {
      throw new ForbiddenException({
        message: 'Trade rejected by compliance rule engine.',
        reasons: result.reasons,
        ruleResults: result.ruleResults,
        decisionId: result.decisionId,
      });
    }

    return result;
  }

  /**
   * Non-throwing variant — returns the result without throwing on rejection.
   * Useful for preview / dry-run endpoints.
   */
  async previewTradeEligibility(
    input: EvaluationInput,
  ): Promise<TradeEligibilityResultDto> {
    try {
      return await this.evaluateTrade(input);
    } catch (err) {
      if (err instanceof ForbiddenException) {
        const body = err.getResponse() as Record<string, unknown>;
        return {
          eligible: false,
          outcome: 'rejected',
          reasons: (body.reasons as string[]) ?? [],
          ruleResults:
            (body.ruleResults as TradeEligibilityResultDto['ruleResults']) ??
            [],
          decisionId: (body.decisionId as string) ?? '',
        };
      }
      throw err;
    }
  }

  /**
   * Retrieve paginated audit decisions for a user.
   */
  async getDecisionsForUser(
    userId: string,
    limit = 50,
    offset = 0,
  ): Promise<TradeEligibilityDecision[]> {
    return this.decisionRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async persistDecision(params: {
    userId: string;
    asset: string;
    counterAsset?: string;
    amount: number;
    outcome: EligibilityDecisionOutcome;
    failedResults: RuleResult[];
    ruleResults: RuleResult[];
    ipAddress?: string;
    countryCode?: string;
  }): Promise<TradeEligibilityDecision> {
    const entity = this.decisionRepository.create({
      userId: params.userId,
      asset: params.asset,
      counterAsset: params.counterAsset,
      amount: params.amount.toString(),
      outcome: params.outcome,
      failedRules:
        params.failedResults.map((r) => r.ruleId).join(',') || undefined,
      rejectionReasons:
        params.failedResults.map((r) => r.reason ?? '').join('; ') || undefined,
      ruleResults: params.ruleResults as unknown as Record<string, unknown>[],
      ipAddress: params.ipAddress,
      countryCode: params.countryCode,
    });

    return this.decisionRepository.save(entity);
  }
}
