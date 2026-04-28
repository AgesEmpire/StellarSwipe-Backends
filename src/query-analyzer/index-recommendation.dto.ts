import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum IndexType {
  BTREE = 'btree',
  HASH = 'hash',
  GIN = 'gin',
  GIST = 'gist',
  BRIN = 'brin',
  PARTIAL = 'partial',
  COMPOSITE = 'composite',
  COVERING = 'covering',
}

export enum IndexImpact {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export class IndexRecommendationDto {
  @ApiProperty({ description: 'Table to index' })
  tableName: string;

  @ApiProperty({ description: 'Schema name', default: 'public' })
  schemaName: string;

  @ApiProperty({ type: [String], description: 'Columns to include in the index' })
  columns: string[];

  @ApiPropertyOptional({ type: [String], description: 'INCLUDE columns for covering indexes' })
  includeColumns?: string[];

  @ApiProperty({ enum: IndexType })
  indexType: IndexType;

  @ApiProperty({ enum: IndexImpact })
  impact: IndexImpact;

  @ApiProperty({ description: 'Rationale for this recommendation' })
  rationale: string;

  @ApiProperty({ description: 'Ready-to-run CREATE INDEX statement' })
  createStatement: string;

  @ApiPropertyOptional({ description: 'Estimated % query time reduction' })
  estimatedImprovement?: number;

  @ApiPropertyOptional({ description: 'Storage overhead estimate in MB' })
  estimatedStorageMb?: number;

  @ApiPropertyOptional({ description: 'Condition clause for partial indexes' })
  whereClause?: string;

  @ApiProperty({ description: 'Whether a similar index already exists' })
  existingIndexConflict: boolean;

  @ApiPropertyOptional({ description: 'Name of conflicting existing index' })
  conflictingIndexName?: string;

  @ApiPropertyOptional({ description: 'Queries this index will benefit' })
  benefitingQueries?: string[];
}

export class IndexAnalysisReportDto {
  @ApiProperty({ type: [IndexRecommendationDto] })
  recommendations: IndexRecommendationDto[];

  @ApiProperty({ description: 'Indexes that can be safely dropped' })
  redundantIndexes: RedundantIndexDto[];

  @ApiProperty({ description: 'Total potential performance gain estimate (%)' })
  totalEstimatedGain: number;

  @ApiProperty()
  analyzedAt: Date;
}

export class RedundantIndexDto {
  @ApiProperty() indexName: string;
  @ApiProperty() tableName: string;
  @ApiProperty({ type: [String] }) columns: string[];
  @ApiProperty() reason: string;
  @ApiProperty() dropStatement: string;
  @ApiPropertyOptional() supersededBy?: string;
}
