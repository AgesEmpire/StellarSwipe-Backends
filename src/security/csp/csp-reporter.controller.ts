import { Controller, Post, Body, Logger, HttpCode } from '@nestjs/common';
import { IsString, IsOptional } from 'class-validator';

class CspViolationDto {
  @IsString()
  @IsOptional()
  'document-uri'?: string;

  @IsString()
  @IsOptional()
  'violated-directive'?: string;

  @IsString()
  @IsOptional()
  'effective-directive'?: string;

  @IsString()
  @IsOptional()
  'original-policy'?: string;

  @IsString()
  @IsOptional()
  'blocked-uri'?: string;

  @IsString()
  @IsOptional()
  'source-file'?: string;

  @IsOptional()
  'line-number'?: number;

  @IsOptional()
  'column-number'?: number;

  @IsString()
  @IsOptional()
  'status-code'?: string;
}

class CspReportDto {
  'csp-report'!: CspViolationDto;
}

@Controller('csp-report')
export class CspReporterController {
  private readonly logger = new Logger(CspReporterController.name);
  private violations: CspViolationDto[] = [];
  private readonly maxViolations = 1000;

  @Post()
  @HttpCode(204)
  handleCspViolation(@Body() report: CspReportDto) {
    const violation = report['csp-report'];

    this.logger.warn('CSP Violation Detected', {
      documentUri: violation['document-uri'],
      violatedDirective: violation['violated-directive'],
      effectiveDirective: violation['effective-directive'],
      blockedUri: violation['blocked-uri'],
      sourceFile: violation['source-file'],
      lineNumber: violation['line-number'],
      columnNumber: violation['column-number'],
    });

    this.violations.push(violation);
    if (this.violations.length > this.maxViolations) {
      this.violations.shift();
    }
  }

  getViolations(): CspViolationDto[] {
    return this.violations;
  }

  clearViolations(): void {
    this.violations = [];
  }
}
