import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { SlaAgreement, SlaAgreementStatus } from './entities/sla-agreement.entity';
import { SlaViolation, ViolationSeverity } from './entities/sla-violation.entity';
import { MetricType } from './entities/sla-metric.entity';
import { SlaConfigDto } from './dto/sla-config.dto';
import { SlaReportDto } from './dto/sla-report.dto';
import { ViolationAlertDto } from './dto/violation-alert.dto';
import { SLA_TIERS, SlaTierName } from './interfaces/sla-tier.interface';
import { UptimeMonitor } from './monitors/uptime-monitor';
import { ResponseTimeMonitor } from './monitors/response-time-monitor';
import { ThroughputMonitor } from './monitors/throughput-monitor';

@Injectable()
export class SlaManagerService {
  private readonly logger = new Logger(SlaManagerService.name);

  constructor(
    @InjectRepository(SlaAgreement)
    private readonly agreementRepo: Repository<SlaAgreement>,
    @InjectRepository(SlaViolation)
    private readonly violationRepo: Repository<SlaViolation>,
    private readonly uptimeMonitor: UptimeMonitor,
    private readonly responseTimeMonitor: ResponseTimeMonitor,
    private readonly throughputMonitor: ThroughputMonitor,
  ) {}

  async createAgreement(dto: SlaConfigDto): Promise<SlaAgreement> {
    const tier = SLA_TIERS[dto.tier];
    const agreement = this.agreementRepo.create({
      userId: dto.userId,
      clientName: dto.clientName,
      tier: dto.tier,
      uptimePercent: tier.uptimePercent.toString(),
      maxResponseTimeMs: tier.maxResponseTimeMs,
      maxErrorRatePercent: tier.maxErrorRatePercent.toString(),
      minThroughputRpm: tier.minThroughputRpm,
      supportResponseHours: tier.supportResponseHours,
      priorityRouting: tier.priorityRouting,
      status: SlaAgreementStatus.ACTIVE,
      startsAt: new Date(dto.startsAt),
      endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
    });

    const saved = await this.agreementRepo.save(agreement);
    this.logger.log(`SLA agreement created for ${dto.clientName} (${dto.tier}): ${saved.id}`);
    return saved;
  }

  async getAgreement(agreementId: string): Promise<SlaAgreement> {
    const agreement = await this.agreementRepo.findOne({ where: { id: agreementId } });
    if (!agreement) throw new NotFoundException(`SLA agreement ${agreementId} not found`);
    return agreement;
  }

  async getAgreementByUser(userId: string): Promise<SlaAgreement | null> {
    return this.agreementRepo.findOne({
      where: { userId, status: SlaAgreementStatus.ACTIVE },
    });
  }

  async generateReport(agreementId: string, periodStart: Date, periodEnd: Date): Promise<SlaReportDto> {
    const agreement = await this.getAgreement(agreementId);

    const [uptime, responseTime, throughput, violations] = await Promise.all([
      this.uptimeMonitor.measure(agreementId, periodStart, periodEnd, parseFloat(agreement.uptimePercent)),
      this.responseTimeMonitor.measure(agreementId, periodStart, periodEnd),
      this.throughputMonitor.measure(agreementId, periodStart, periodEnd),
      this.violationRepo.find({
        where: { agreementId, createdAt: Between(periodStart, periodEnd) },
      }),
    ]);

    const breachCount = violations.filter((v) => v.severity === ViolationSeverity.BREACH || v.severity === ViolationSeverity.CRITICAL).length;

    const slaCompliant =
      uptime.uptimePercent >= parseFloat(agreement.uptimePercent) &&
      responseTime.p95 <= agreement.maxResponseTimeMs &&
      throughput.errorRatePercent <= parseFloat(agreement.maxErrorRatePercent) &&
      (throughput.avgRpm === 0 || throughput.avgRpm >= agreement.minThroughputRpm);

    return {
      agreementId,
      userId: agreement.userId,
      clientName: agreement.clientName,
      tier: agreement.tier,
      periodStart,
      periodEnd,
      uptimePercent: uptime.uptimePercent,
      avgResponseTimeMs: responseTime.avg,
      p95ResponseTimeMs: responseTime.p95,
      errorRatePercent: throughput.errorRatePercent,
      avgThroughputRpm: throughput.avgRpm,
      totalViolations: violations.length,
      breachCount,
      slaCompliant,
    };
  }

  async checkAndRecordViolations(agreementId: string): Promise<ViolationAlertDto[]> {
    const agreement = await this.getAgreement(agreementId);
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - 60 * 60 * 1000); // last 1h

    const [uptime, responseTime, throughput] = await Promise.all([
      this.uptimeMonitor.measure(agreementId, windowStart, windowEnd, parseFloat(agreement.uptimePercent)),
      this.responseTimeMonitor.measure(agreementId, windowStart, windowEnd),
      this.throughputMonitor.measure(agreementId, windowStart, windowEnd),
    ]);

    const alerts: ViolationAlertDto[] = [];

    // Uptime check
    if (uptime.breached) {
      alerts.push(await this.recordViolation(agreement, MetricType.UPTIME, parseFloat(agreement.uptimePercent), uptime.uptimePercent));
    }

    // Response time check (p95)
    if (responseTime.p95 > agreement.maxResponseTimeMs) {
      alerts.push(await this.recordViolation(agreement, MetricType.RESPONSE_TIME, agreement.maxResponseTimeMs, responseTime.p95));
    }

    // Error rate check
    if (throughput.errorRatePercent > parseFloat(agreement.maxErrorRatePercent)) {
      alerts.push(await this.recordViolation(agreement, MetricType.ERROR_RATE, parseFloat(agreement.maxErrorRatePercent), throughput.errorRatePercent));
    }

    // Throughput check (only if we have data)
    if (throughput.avgRpm > 0 && throughput.avgRpm < agreement.minThroughputRpm) {
      alerts.push(await this.recordViolation(agreement, MetricType.THROUGHPUT, agreement.minThroughputRpm, throughput.avgRpm));
    }

    return alerts;
  }

  async getViolations(agreementId: string, since?: Date): Promise<SlaViolation[]> {
    const where: any = { agreementId };
    if (since) where.createdAt = Between(since, new Date());
    return this.violationRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async resolveViolation(violationId: string): Promise<SlaViolation> {
    const violation = await this.violationRepo.findOneOrFail({ where: { id: violationId } });
    violation.resolvedAt = new Date();
    return this.violationRepo.save(violation);
  }

  async listAgreements(tier?: SlaTierName): Promise<SlaAgreement[]> {
    const where: any = { status: SlaAgreementStatus.ACTIVE };
    if (tier) where.tier = tier;
    return this.agreementRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async terminateAgreement(agreementId: string): Promise<SlaAgreement> {
    const agreement = await this.getAgreement(agreementId);
    agreement.status = SlaAgreementStatus.TERMINATED;
    return this.agreementRepo.save(agreement);
  }

  private async recordViolation(
    agreement: SlaAgreement,
    metricType: MetricType,
    threshold: number,
    actual: number,
  ): Promise<ViolationAlertDto> {
    const deviation = Math.abs(actual - threshold) / threshold;
    const severity = deviation > 0.5
      ? ViolationSeverity.CRITICAL
      : deviation > 0.2
        ? ViolationSeverity.BREACH
        : ViolationSeverity.WARNING;

    const message = `${metricType} SLA breached for ${agreement.clientName}: threshold=${threshold}, actual=${actual.toFixed(4)}`;

    await this.violationRepo.save(
      this.violationRepo.create({
        agreementId: agreement.id,
        metricType,
        severity,
        thresholdValue: threshold.toString(),
        actualValue: actual.toFixed(4),
        message,
        alertSent: false,
      }),
    );

    this.logger.warn(`[${severity.toUpperCase()}] ${message}`);

    return {
      agreementId: agreement.id,
      clientName: agreement.clientName,
      metricType,
      severity,
      thresholdValue: threshold,
      actualValue: actual,
      message,
      detectedAt: new Date(),
    };
  }
}
