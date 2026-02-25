import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { UserDataExporterService } from './exporters/user-data-exporter.service';
import { TradeReportExporterService } from './exporters/trade-report-exporter.service';
import { AuditTrailExporterService } from './exporters/audit-trail-exporter.service';
import { GdprReportGenerator } from './reports/gdpr-report.generator';
import { FinancialReportGenerator } from './reports/financial-report.generator';
import { ExportFormat } from './dto/export-request.dto';
import { writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import * as crypto from 'crypto';
import { existsSync } from 'fs';

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);
  private readonly exportDir: string;

  constructor(
    private configService: ConfigService,
    private userDataExporter: UserDataExporterService,
    private tradeReportExporter: TradeReportExporterService,
    private auditExporter: AuditTrailExporterService,
    private gdprGenerator: GdprReportGenerator,
    private financialGenerator: FinancialReportGenerator,
  ) {
    this.exportDir = this.configService.get('EXPORT_DIR', '/tmp/exports');
    this.ensureExportDir();
  }

  private async ensureExportDir(): Promise<void> {
    if (!existsSync(this.exportDir)) {
      await mkdir(this.exportDir, { recursive: true });
    }
  }

  async exportUserData(userId: string, format: ExportFormat = ExportFormat.JSON): Promise<string> {
    this.logger.log(`Exporting user data for ${userId} in ${format} format`);

    const userData = await this.userDataExporter.exportUserData(userId);
    const fileName = `user_export_${userId}_${Date.now()}.${format}`;
    const filePath = join(this.exportDir, fileName);

    let fileContent: string;
    if (format === ExportFormat.JSON) {
      fileContent = JSON.stringify(userData, null, 2);
    } else if (format === ExportFormat.CSV) {
      fileContent = this.convertToCSV(userData);
    } else {
      throw new Error('PDF format not yet implemented');
    }

    const encrypted = this.encryptFile(fileContent);
    await writeFile(filePath, encrypted);

    this.scheduleFileDeletion(filePath, 7);

    return filePath;
  }

  async generateComplianceReport(type: string, startDate: Date, endDate: Date): Promise<any> {
    this.logger.log(`Generating ${type} compliance report`);

    switch (type) {
      case 'trade_volume':
        return this.tradeReportExporter.generateTradeVolumeReport(startDate, endDate);
      case 'financial_summary':
        return this.tradeReportExporter.generateFinancialSummary(startDate, endDate);
      case 'audit_trail':
        return this.auditExporter.generateAuditReport(startDate, endDate, true);
      default:
        throw new Error(`Unknown report type: ${type}`);
    }
  }

  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async generateMonthlyReports(): Promise<void> {
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1);

    this.logger.log(`Generating monthly compliance reports for ${lastMonth.toISOString()}`);

    try {
      const report = await this.financialGenerator.generateMonthlyComplianceReport(
        lastMonth.getFullYear(),
        lastMonth.getMonth() + 1,
      );

      const fileName = `compliance_report_${lastMonth.getFullYear()}_${String(lastMonth.getMonth() + 1).padStart(2, '0')}.json`;
      const filePath = join(this.exportDir, fileName);

      await writeFile(filePath, JSON.stringify(report, null, 2));
      this.logger.log(`Monthly compliance report saved to ${filePath}`);
    } catch (error) {
      this.logger.error(`Failed to generate monthly report: ${error.message}`);
    }
  }

  private encryptFile(content: string): string {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(this.configService.get('ENCRYPTION_KEY', 'default-key'), 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);

    let encrypted = cipher.update(content, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    return JSON.stringify({
      iv: iv.toString('hex'),
      data: encrypted,
    });
  }

  private convertToCSV(data: any): string {
    if (!data.trades || data.trades.length === 0) return '';

    const headers = Object.keys(data.trades[0]).join(',');
    const rows = data.trades.map((trade: any) => Object.values(trade).join(',')).join('\n');

    return `${headers}\n${rows}`;
  }

  private scheduleFileDeletion(filePath: string, days: number): void {
    const deleteAt = Date.now() + days * 24 * 60 * 60 * 1000;
    setTimeout(async () => {
      try {
        await unlink(filePath);
        this.logger.log(`Auto-deleted export file: ${filePath}`);
      } catch (error) {
        this.logger.error(`Failed to delete file ${filePath}: ${error.message}`);
      }
    }, deleteAt - Date.now());
  }
}
