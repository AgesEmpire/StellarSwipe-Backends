import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { AuditLog } from '../../audit-log/audit-log.entity';

@Injectable()
export class AuditTrailExporterService {
  constructor(@InjectRepository(AuditLog) private auditRepo: Repository<AuditLog>) {}

  async generateAuditReport(startDate: Date, endDate: Date, anonymize = true): Promise<any> {
    const logs = await this.auditRepo.find({
      where: { createdAt: Between(startDate, endDate) },
      order: { createdAt: 'DESC' },
    });

    const actionCounts = logs.reduce((acc, log) => {
      acc[log.action] = (acc[log.action] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const failedActions = logs.filter((l) => l.status === 'FAILURE');
    const suspiciousActivities = logs.filter((l) => l.action === 'SUSPICIOUS_ACTIVITY');

    return {
      period: `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`,
      totalEvents: logs.length,
      actionBreakdown: actionCounts,
      failedActions: failedActions.length,
      suspiciousActivities: suspiciousActivities.length,
      events: logs.slice(0, 100).map((log) => ({
        action: log.action,
        timestamp: log.createdAt,
        userId: anonymize ? this.anonymizeUserId(log.userId) : log.userId,
        status: log.status,
        ipAddress: anonymize ? this.anonymizeIp(log.ipAddress) : log.ipAddress,
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  private anonymizeUserId(userId: string): string {
    if (!userId) return 'anonymous';
    return `user_${userId.substring(0, 8)}***`;
  }

  private anonymizeIp(ip: string): string {
    if (!ip) return 'unknown';
    const parts = ip.split('.');
    return parts.length === 4 ? `${parts[0]}.${parts[1]}.***.**` : 'anonymized';
  }
}
