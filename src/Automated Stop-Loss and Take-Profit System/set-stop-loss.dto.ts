import { IsNumber, IsPositive, IsOptional, IsBoolean, Min, Max } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetStopLossDto {
  @ApiProperty({ description: 'Position ID to set stop-loss for' })
  positionId: string;

  @ApiProperty({ description: 'Stop-loss price threshold' })
  @IsNumber()
  @IsPositive()
  stopLossPrice: number;

  @ApiPropertyOptional({ description: 'Enable trailing stop-loss', default: false })
  @IsOptional()
  @IsBoolean()
  trailing?: boolean;

  @ApiPropertyOptional({ description: 'Trailing stop percentage (e.g. 5 = 5%)', default: 5 })
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(50)
  trailingPercent?: number;
}
