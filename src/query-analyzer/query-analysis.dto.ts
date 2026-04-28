import {
  IsString,
  IsOptional,
  IsNumber,
  IsArray,
  IsEnum,
  IsPositive,
  Min,
  Max,
  IsUUID,
  IsDateString,
  ValidateNested,
  IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Submit Query for Analysis ────────────────────────────────────────────────

export class SubmitQueryAnalysisDto {
  @ApiProperty({ description: 'Raw SQL query to analyze', type: String })
  @IsString()
  query: string;

  @ApiPropertyOptional({ description: 'Query execution time in milliseconds' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  executionTime?: number;

  @ApiPropertyOptional({ description: 'Query parameters used during execution' })
  @IsOptional()
  @IsArray()
  parameters?: any[];

  @ApiPropertyOptional({ description: 'Target database name' })
  @IsOptional()
  @IsString()
  databaseName?: string;

  @ApiPropertyOptional({ description: 'Target schema name', default: 'public' })
  @IsOptional()
  @IsString()
  schemaName?: string;

  @ApiPropertyOptional({ description: 'Originating service name' })
  @IsOptional()
  @IsString()
  callerService?: string;

  @ApiPropertyOptional({ description: 'Originating HTTP endpoint' })
  @IsOptional()
  @IsString()
  callerEndpoint?: string;

  @ApiPropertyOptional({ description: 'Whether to run EXPLAIN ANALYZE (may be slow)' })
  @IsOptional()
  @IsBoolean()
  runExplainAnalyze?: boolean;
}

// ─── Bulk Ingestion ───────────────────────────────────────────────────────────

export class BulkQueryIngestionDto {
  @ApiProperty({ type: [SubmitQueryAnalysisDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubmitQueryAnalysisDto)
  queries: SubmitQueryAnalysisDto[];
}

// ─── Analysis Result ──────────────────────────────────────────────────────────

export enum AnalysisComplexity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export class QueryAnalysisResultDto {
  @ApiProperty() id: string;
  @ApiProperty() queryHash: string;
  @ApiProperty() normalizedQuery: string;
  @ApiProperty() executionTime: number;
  @ApiProperty() complexity: AnalysisComplexity;
  @ApiProperty() tablesInvolved: string[];
  @ApiProperty() seqScans: number;
  @ApiProperty() indexScans: number;
  @ApiProperty() totalCost: number;
  @ApiProperty() hasMissingIndexes: boolean;
  @ApiProperty() hasSuboptimalJoins: boolean;
  @ApiProperty() status: string;
  @ApiProperty() analyzedAt: Date;
}

// ─── Query List / Filter ──────────────────────────────────────────────────────

export class QueryFilterDto {
  @ApiPropertyOptional({ enum: AnalysisComplexity })
  @IsOptional()
  @IsEnum(AnalysisComplexity)
  complexity?: AnalysisComplexity;

  @ApiPropertyOptional({ description: 'Minimum execution time in ms' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minExecutionTime?: number;

  @ApiPropertyOptional({ description: 'Maximum execution time in ms' })
  @IsOptional()
  @IsNumber()
  minExecutionTimeMax?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  callerService?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  table?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  hasMissingIndexes?: boolean;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}

// ─── Mark Optimization Applied ────────────────────────────────────────────────

export class MarkOptimizationAppliedDto {
  @ApiProperty()
  @IsUUID()
  optimizationId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  verifiedImprovement?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  appliedBy?: string;
}
