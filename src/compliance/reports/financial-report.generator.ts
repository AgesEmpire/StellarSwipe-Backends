import { Injectable } from '@nestjs/common';
import { TradeReportExporterService } from '../exporters/trade-report-exporter.service';
import { AuditTrailExporterService } from '../exporters/audit-trail-exporter.service';
import { AmlMonitoringService } from '../aml/aml-monitoring.service';

@Injectable()
export class FinancialReportGenerator {
  constructor(
    private tradeReportExporter: TradeReportExporterService,
    private auditExporter: AuditTrailExporterService,
    private amlService: AmlMonitoringService,
  ) {}

  async generateMonthlyComplianceReport(year: number, month: number): Promise<any> {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const [tradeVolume, financial, auditTrail, amlRisks] = await Promise.all([
      this.tradeReportExporter.generateTradeVolumeReport(startDate, endDate),
      this.tradeReportExporter.generateFinancialSummary(startDate, endDate),
      this.auditExporter.generateAuditReport(startDate, endDate, true),
      this.getAmlRiskSummary(startDate, endDate),
    ]);

    return {
      reportType: 'Monthly Compliance Report',
      period: `${year}-${String(month).padStart(2, '0')}`,
      tradeVolume,
      financial,
      auditTrail: {
        totalEvents: auditTrail.totalEvents,
        failedActions: auditTrail.failedActions,
        suspiciousActivities: auditTrail.suspiciousActivities,
      },
      amlRisks,
      generatedAt: new Date().toISOString(),
    };
  }

  private async getAmlRiskSummary(startDate: Date, endDate: Date): Promise<any> {
    return {
      highRiskTransactions: 0,
      suspiciousPatterns: [],
      actionsRequired: 0,
    };
  }
}
