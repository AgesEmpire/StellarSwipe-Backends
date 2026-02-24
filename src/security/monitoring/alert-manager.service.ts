import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SecurityAlert,
  AlertSeverity,
  AlertType,
} from '../entities/security-alert.entity';
import {
  SecurityIncident,
  IncidentStatus,
  IncidentSeverity,
} from '../entities/security-incident.entity';
import {
  CreateSecurityAlertDto,
  ResolveAlertDto,
} from '../dto/security-alert.dto';

export interface AlertNotification {
  userId: string;
  email?: string;
  phone?: string;
  severity: AlertSeverity;
  type: AlertType;
  details: Record<string, unknown>;
}

@Injectable()
export class AlertManagerService {
  private readonly logger = new Logger(AlertManagerService.name);

  constructor(
    @InjectRepository(SecurityAlert)
    private readonly alertRepository: Repository<SecurityAlert>,
    @InjectRepository(SecurityIncident)
    private readonly incidentRepository: Repository<SecurityIncident>,
  ) {}

  // ─── Create Alert ─────────────────────────────────────────────────────────

  async createAlert(dto: CreateSecurityAlertDto): Promise<SecurityAlert> {
    // Dedup: skip if identical unresolved alert within 5 minutes
    const recentCutoff = new Date(Date.now() - 5 * 60 * 1000);
    const existing = await this.alertRepository.findOne({
      where: {
        userId: dto.userId,
        type: dto.type,
        severity: dto.severity,
        resolved: false,
      },
      order: { createdAt: 'DESC' },
    });

    if (existing && existing.createdAt > recentCutoff) {
      this.logger.debug(
        `Deduplicating alert for user ${dto.userId}, type ${dto.type}`,
      );
      return existing;
    }

    const alert = this.alertRepository.create({
      userId: dto.userId,
      type: dto.type,
      severity: dto.severity,
      details: dto.details ?? {},
    });

    const saved = await this.alertRepository.save(alert);
    this.logger.log(
      `Created ${dto.severity} alert [${dto.type}] for user ${dto.userId}`,
    );

    return saved;
  }

  // ─── Resolve Alert ────────────────────────────────────────────────────────

  async resolveAlert(
    alertId: string,
    dto: ResolveAlertDto,
  ): Promise<SecurityAlert> {
    const alert = await this.alertRepository.findOneOrFail({
      where: { id: alertId },
    });

    alert.resolved = true;
    alert.resolvedBy = dto.resolvedBy;
    alert.resolvedAt = new Date();
    alert.resolutionNote = dto.resolutionNote ?? null;
    alert.falsePositive = dto.falsePositive ?? false;

    const saved = await this.alertRepository.save(alert);
    this.logger.log(`Alert ${alertId} resolved by ${dto.resolvedBy}`);

    return saved;
  }

  // ─── Create Security Incident ─────────────────────────────────────────────

  async createIncident(
    userId: string,
    title: string,
    alertIds: string[],
    severity: IncidentSeverity,
    metadata: Record<string, unknown> = {},
  ): Promise<SecurityIncident> {
    const incident = this.incidentRepository.create({
      userId,
      title,
      alertIds,
      severity,
      status: IncidentStatus.OPEN,
      metadata,
      timeline: [
        {
          timestamp: new Date(),
          action: 'INCIDENT_CREATED',
          actor: 'SYSTEM',
          details: { alertCount: alertIds.length },
        },
      ],
    });

    const saved = await this.incidentRepository.save(incident);
    this.logger.warn(`Security incident created for user ${userId}: ${title}`);
    return saved;
  }

  // ─── Update Incident Status ───────────────────────────────────────────────

  async updateIncidentStatus(
    incidentId: string,
    status: IncidentStatus,
    actorId: string,
    note?: string,
  ): Promise<SecurityIncident> {
    const incident = await this.incidentRepository.findOneOrFail({
      where: { id: incidentId },
    });

    const previousStatus = incident.status;
    incident.status = status;

    incident.timeline = [
      ...incident.timeline,
      {
        timestamp: new Date(),
        action: `STATUS_CHANGED`,
        actor: actorId,
        details: { from: previousStatus, to: status, note },
      },
    ];

    if (
      status === IncidentStatus.RESOLVED ||
      status === IncidentStatus.FALSE_POSITIVE
    ) {
      incident.resolvedAt = new Date();
      incident.resolvedBy = actorId;
    }

    return this.incidentRepository.save(incident);
  }

  // ─── Get User Alerts ──────────────────────────────────────────────────────

  async getUserAlerts(
    userId: string,
    unresolvedOnly = false,
  ): Promise<SecurityAlert[]> {
    const where: Partial<SecurityAlert> = { userId };
    if (unresolvedOnly) where.resolved = false;
    return this.alertRepository.find({
      where,
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  // ─── Dashboard Stats ──────────────────────────────────────────────────────

  async getDashboardStats() {
    const [totalAlerts, unresolvedAlerts, criticalAlerts] = await Promise.all([
      this.alertRepository.count(),
      this.alertRepository.count({ where: { resolved: false } }),
      this.alertRepository.count({
        where: { severity: AlertSeverity.CRITICAL, resolved: false },
      }),
    ]);

    const openIncidents = await this.incidentRepository.count({
      where: { status: IncidentStatus.OPEN },
    });

    // Alerts by type
    const byType = await this.alertRepository
      .createQueryBuilder('a')
      .select('a.type', 'type')
      .addSelect('COUNT(*)', 'count')
      .groupBy('a.type')
      .getRawMany();

    // Alerts by severity
    const bySeverity = await this.alertRepository
      .createQueryBuilder('a')
      .select('a.severity', 'severity')
      .addSelect('COUNT(*)', 'count')
      .groupBy('a.severity')
      .getRawMany();

    // Recent 10 unresolved alerts
    const recentAlerts = await this.alertRepository.find({
      where: { resolved: false },
      order: { createdAt: 'DESC' },
      take: 10,
    });

    // 7-day trend
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const trend = await this.alertRepository
      .createQueryBuilder('a')
      .select("DATE_TRUNC('day', a.createdAt)", 'date')
      .addSelect('COUNT(*)', 'count')
      .where('a.createdAt >= :from', { from: sevenDaysAgo })
      .groupBy("DATE_TRUNC('day', a.createdAt)")
      .orderBy("DATE_TRUNC('day', a.createdAt)", 'ASC')
      .getRawMany();

    return {
      totalAlerts,
      unresolvedAlerts,
      criticalAlerts,
      openIncidents,
      alertsByType: Object.fromEntries(
        byType.map((r) => [r.type, parseInt(r.count, 10)]),
      ),
      alertsBySeverity: Object.fromEntries(
        bySeverity.map((r) => [r.severity, parseInt(r.count, 10)]),
      ),
      recentAlerts,
      alertTrend: trend.map((r) => ({
        date: new Date(r.date).toISOString().split('T')[0],
        count: parseInt(r.count, 10),
      })),
    };
  }

  // ─── Mark notification sent ───────────────────────────────────────────────

  async markNotificationSent(alertId: string): Promise<void> {
    await this.alertRepository.update(alertId, { notificationSent: true });
  }
}
