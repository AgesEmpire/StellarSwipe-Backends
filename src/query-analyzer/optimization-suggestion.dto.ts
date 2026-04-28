import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsNumber, IsArray, IsUUID } from 'class-validator';
import { OptimizationType, OptimizationPriority, OptimizationStatus } from '../entities/query-optimization.entity';

export class OptimizationSuggestionDto {
  @ApiProperty() id: string;
  @ApiProperty() slowQueryId: string;
  @ApiProperty({ enum: OptimizationType }) type: OptimizationType;
  @ApiProperty({ enum: OptimizationPriority }) priority: OptimizationPriority;
  @ApiProperty({ enum: OptimizationStatus }) status: OptimizationStatus;
  @ApiProperty() title: string;
  @ApiProperty() description: string;
  @ApiPropertyOptional() sqlStatement?: string;
  @ApiPropertyOptional() rewrittenQuery?: string;
  @ApiPropertyOptional({ description: '% improvement estimate' }) estimatedImprovement?: number;
  @ApiPropertyOptional({ description: 'ms saved estimate' }) estimatedTimeSavedMs?: number;
  @ApiPropertyOptional() affectedTable?: string;
  @ApiProperty({ type: [String] }) affectedColumns: string[];
  @ApiPropertyOptional() metadata?: Record<string, any>;
  @ApiProperty() createdAt: Date;
}

export class OptimizationFilterDto {
  @ApiPropertyOptional({ enum: OptimizationType })
  @IsOptional()
  @IsEnum(OptimizationType)
  type?: OptimizationType;

  @ApiPropertyOptional({ enum: OptimizationPriority })
  @IsOptional()
  @IsEnum(OptimizationPriority)
  priority?: OptimizationPriority;

  @ApiPropertyOptional({ enum: OptimizationStatus })
  @IsOptional()
  @IsEnum(OptimizationStatus)
  status?: OptimizationStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  slowQueryId?: string;
}

export class CreateOptimizationDto {
  @IsUUID()
  slowQueryId: string;

  @IsEnum(OptimizationType)
  type: OptimizationType;

  @IsEnum(OptimizationPriority)
  priority: OptimizationPriority;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  sqlStatement?: string;

  @IsOptional()
  @IsString()
  rewrittenQuery?: string;

  @IsOptional()
  @IsNumber()
  estimatedImprovement?: number;

  @IsOptional()
  @IsNumber()
  estimatedTimeSavedMs?: number;

  @IsOptional()
  @IsString()
  affectedTable?: string;

  @IsOptional()
  @IsArray()
  affectedColumns?: string[];

  @IsOptional()
  metadata?: Record<string, any>;
}
