import {
  Injectable,
  Logger,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, FindOptionsWhere } from 'typeorm';
import { AuditLog, AuditAction, AuditStatus } from '../../audit-log/entities/audit-log.entity';
import {
  AuditExportRequestDto,
  AuditExportFormat,
} from './dto/export-request.dto';
import { AuditExportResultDto } from './dto/export-result.dto';
import { formatAuditExport } from './utils/export-formatter';
import { v4 as uuidv4 } from 'uuid';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { ConfigService } from '@nestjs/config';

/**
 * Compliance roles that are allowed to export audit data.
 */
export const COMPLIANCE_ROLES = ['compliance_officer', 'admin', 'auditor'];

/**
 * Service for generating compliance audit exports.
 * Restricted to compliance roles only.
 */
@Injectable()
export class ComplianceExportService {
  private readonly logger = new Logger(ComplianceExportService.name);
  private readonly exportDir: string;

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
    private readonly configService: ConfigService,
  ) {
    this.exportDir =
      this.configService.get<string>('EXPORT_DIR', '/tmp/exports');
    this.ensureExportDir();
  }

  /**
   * Verify that the user has the required compliance role.
   */
  assertComplianceRole(user: any): void {
    const userRole = user?.role ?? user?.roles ?? user?.roleName;

    if (!userRole) {
      throw new ForbiddenException(
        'Access denied. Compliance role required.',
      );
    }

    const roles = Array.isArray(userRole) ? userRole : [userRole];
    const hasComplianceRole = roles.some((r: string) =>
      COMPLIANCE_ROLES.includes(r.toLowerCase()),
    );

    if (!hasComplianceRole) {
      this.logger.warn(
        `Access denied for user ${user?.id} with role(s) ${roles.join(', ')}`,
      );
      throw new ForbiddenException(
        'Access denied. Compliance role required.',
      );
    }
  }

  /**
   * Export audit logs with filters.
   */
  async export(
    user: any,
    dto: AuditExportRequestDto,
  ): Promise<AuditExportResultDto> {
    this.assertComplianceRole(user);

    const format = dto.format ?? AuditExportFormat.CSV;
    const logs = await this.queryAuditLogs(dto);

    if (logs.length === 0) {
      throw new BadRequestException(
        'No audit records found matching the specified filters.',
      );
    }

    const formatted = formatAuditExport(logs, format);

    // Persist to file
    const exportId = uuidv4();
    const fileName = `audit_export_${exportId}.${formatted.extension}`;
    const filePath = join(this.exportDir, fileName);

    await writeFile(filePath, formatted.content, 'utf-8');

    this.logger.log(
      `Audit export ${exportId} generated with ${logs.length} records (${format})`,
    );

    // Schedule auto-deletion after 7 days (in production, use a more robust mechanism)
    setTimeout(async () => {
      try {
        const { unlink } = await import('fs/promises');
        await unlink(filePath);
        this.logger.log(`Auto-deleted audit export: ${filePath}`);
      } catch (error) {
        this.logger.error(`Failed to delete audit export ${filePath}: ${(error as Error).message}`);
      }
    }, 7 * 24 * 60 * 60 * 1000);

    return {
      id: exportId,
      format: format,
      recordCount: logs.length,
      downloadUrl: `/compliance/audit-exports/download/${fileName}`,
      generatedAt: new Date(),
      fileSizeBytes: Buffer.byteLength(formatted.content, 'utf-8'),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
  }

  /**
   * Query audit logs with filters.
   */
  private async queryAuditLogs(
    dto: AuditExportRequestDto,
  ): Promise<AuditLog[]> {
    const where: FindOptionsWhere<AuditLog> = {};

    if (dto.userId) {
      where.userId = dto.userId;
    }

    if (dto.action) {
      where.action = dto.action as AuditAction;
    }

    if (dto.resource) {
      where.resource = dto.resource;
    }

    if (dto.resourceId) {
      where.resourceId = dto.resourceId;
    }

    if (dto.startDate || dto.endDate) {
      const start = dto.startDate
        ? new Date(dto.startDate)
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const end = dto.endDate ? new Date(dto.endDate) : new Date();
      where.createdAt = Between(start, end) as any;
    }

    // If multiple actions specified, filter by them
    if (dto.actions && dto.actions.length > 0) {
      return this.auditLogRepository.find({
        where: [
          ...dto.actions.map((action) => ({ ...where, action } as any)),
        ],
        order: { createdAt: 'DESC' },
      });
    }

    return this.auditLogRepository.find({
      where,
      order: { createdAt: 'DESC' },
    });
  }

  private async ensureExportDir(): Promise<void> {
    if (!existsSync(this.exportDir)) {
      await mkdir(this.exportDir, { recursive: true });
    }
  }
}
