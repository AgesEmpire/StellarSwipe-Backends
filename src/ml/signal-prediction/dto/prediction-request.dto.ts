import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class PredictionRequestDto {
  @ApiProperty({ description: 'Signal UUID to generate a prediction for' })
  @IsUUID()
  signalId!: string;

  @ApiPropertyOptional({
    description: 'Force refresh — skip cache and recompute prediction',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;

  @ApiPropertyOptional({
    description: 'Include feature importance breakdown in the response',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  includeFeatureImportance?: boolean;
}
