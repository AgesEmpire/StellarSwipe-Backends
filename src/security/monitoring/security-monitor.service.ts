import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import {
  AnomalyDetectorService,
  LoginContext,
  TradeContext,
  WalletChangeContext,
  ApiRequestContext,
} from './anomaly-detector.service';
import { AlertManagerService } from './alert-manager.service';
import {
  SecurityAlert,
  AlertSeverity,
} from '../entities/security-alert.entity';
import { IncidentSeverity } from '../entities/security-incident.entity';
import {
  CreateSecurityAlertDto,
  ResolveAlertDto,
} from '../dto/security-alert.dto';

// Events emitted for downstream consumers (e.g., email/SMS service)
export const SECURITY_EVENTS = {
  ALERT_CREATED: 'security.alert.created',
  ACCOUNT_LOCKED: 'security.account.locked',
  INCIDENT_CREATED: 'security.incident.created',
};

@Injectable()
export class SecurityMonitorService {
  private readonly logger = new Logger(SecurityMonitorService.name);

  constructor(
    private readonly anomalyDetector: AnomalyDetectorService,
    private readonly alertManager: AlertManagerService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ─── Monitor Login Events ─────────────────────────────────────────────────

  async monitorLogin(ctx: LoginContext): Promise<void> {
    const [failedResult, locationResult] = await Promise.all([
      this.anomalyDetector.detectFailedLogin(ctx),
      ctx.success
        ? this.anomalyDetector.detectNewLocation(ctx)
        : Promise.resolve({ detected: false }),
    ]);

    for (const result of [failedResult, locationResult]) {
      if (result.detected && result.type && result.severity) {
        await this.processAnomaly({
          userId: ctx.userId,
          type: result.type,
          severity: result.severity,
          details: result.details ?? {},
        });
      }
    }
  }

  // ─── Monitor Trade Events ─────────────────────────────────────────────────

  async monitorTrade(ctx: TradeContext): Promise<void> {
    const result = await this.anomalyDetector.detectUnusualTradeVolume(ctx);
    if (result.detected && result.type && result.severity) {
      await this.processAnomaly({
        userId: ctx.userId,
        type: result.type,
        severity: result.severity,
        details: result.details ?? {},
      });
    }
  }

  // ─── Monitor Wallet Changes ───────────────────────────────────────────────

  async monitorWalletChange(ctx: WalletChangeContext): Promise<void> {
    const result = await this.anomalyDetector.detectRapidWalletChanges(ctx);
    if (result.detected && result.type && result.severity) {
      await this.processAnomaly({
        userId: ctx.userId,
        type: result.type,
        severity: result.severity,
        details: result.details ?? {},
      });
    }
  }

  // ─── Monitor API Requests ─────────────────────────────────────────────────

  async monitorApiRequest(ctx: ApiRequestContext): Promise<void> {
    const result = await this.anomalyDetector.detectApiRateAbuse(ctx);
    if (result.detected && result.type && result.severity) {
      await this.processAnomaly({
        userId: ctx.userId,
        type: result.type,
        severity: result.severity,
        details: result.details ?? {},
      });
    }
  }

  // ─── Core Anomaly Processing ──────────────────────────────────────────────

  private async processAnomaly(dto: CreateSecurityAlertDto): Promise<void> {
    const alert = await this.alertManager.createAlert(dto);

    // Emit event for notification services
    this.eventEmitter.emit(SECURITY_EVENTS.ALERT_CREATED, { alert });

    await this.executeAutoResponse(alert);
  }

  // ─── Auto-Response by Severity ────────────────────────────────────────────

  private async executeAutoResponse(alert: SecurityAlert): Promise<void> {
    switch (alert.severity) {
      case AlertSeverity.CRITICAL:
        await this.handleCriticalAlert(alert);
        break;

      case AlertSeverity.WARNING:
        await this.handleWarningAlert(alert);
        break;

      case AlertSeverity.INFO:
        // INFO: log only (already saved to DB)
        this.logger.log(
          `[INFO] Security alert for user ${alert.userId}: ${alert.type}`,
        );
        break;
    }
  }

  private async handleCriticalAlert(alert: SecurityAlert): Promise<void> {
    this.logger.warn(
      `[CRITICAL] Auto-locking account for user ${alert.userId}`,
    );

    // Emit account lock event (consumed by UsersService or AuthService)
    this.eventEmitter.emit(SECURITY_EVENTS.ACCOUNT_LOCKED, {
      userId: alert.userId,
      reason: alert.type,
      alertId: alert.id,
      requires2FAReeset: true,
    });

    // Create security incident for investigation
    const incident = await this.alertManager.createIncident(
      alert.userId,
      `Critical Security Event: ${alert.type}`,
      [alert.id],
      IncidentSeverity.CRITICAL,
      {
        alertType: alert.type,
        autoLocked: true,
        details: alert.details,
      },
    );

    this.eventEmitter.emit(SECURITY_EVENTS.INCIDENT_CREATED, { incident });

    // Notify user (email + SMS)
    this.emitUserNotification(alert, 'CRITICAL');
  }

  private async handleWarningAlert(alert: SecurityAlert): Promise<void> {
    this.logger.warn(
      `[WARNING] Security warning for user ${alert.userId}: ${alert.type}`,
    );

    // Emit notification event (email only for warnings)
    this.emitUserNotification(alert, 'WARNING');

    // For new location logins, require 2FA before proceeding
    if (alert.details?.require2FA) {
      this.eventEmitter.emit('security.require_2fa', {
        userId: alert.userId,
        reason: 'NEW_LOCATION_LOGIN',
        alertId: alert.id,
      });
    }
  }

  private emitUserNotification(alert: SecurityAlert, level: string): void {
    this.eventEmitter.emit('notification.security', {
      userId: alert.userId,
      level,
      alertType: alert.type,
      alertId: alert.id,
      details: alert.details,
      timestamp: alert.createdAt,
    });
  }

  // ─── Admin Operations ─────────────────────────────────────────────────────

  async resolveAlert(
    alertId: string,
    dto: ResolveAlertDto,
  ): Promise<SecurityAlert> {
    return this.alertManager.resolveAlert(alertId, dto);
  }

  async getDashboard() {
    return this.alertManager.getDashboardStats();
  }

  async getUserAlerts(userId: string, unresolvedOnly = false) {
    return this.alertManager.getUserAlerts(userId, unresolvedOnly);
  }

  async resetUserSecurityCounters(userId: string): Promise<void> {
    await this.anomalyDetector.resetUserCounters(userId);
    this.logger.log(`Security counters reset for user ${userId}`);
  }
}
