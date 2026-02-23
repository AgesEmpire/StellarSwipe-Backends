import { IsNumber, IsPositive, IsOptional, IsArray, ArrayMinSize } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TakeProfitLevel {
  @ApiProperty({ description: 'Price target for this level' })
  @IsNumber()
  @IsPositive()
  price: number;

  @ApiProperty({ description: 'Percentage of position to close at this level (1-100)' })
  @IsNumber()
  @IsPositive()
  closePercent: number;
}

export class SetTakeProfitDto {
  @ApiProperty({ description: 'Position ID to set take-profit for' })
  positionId: string;

  @ApiProperty({ description: 'Primary take-profit price' })
  @IsNumber()
  @IsPositive()
  takeProfitPrice: number;

  @ApiPropertyOptional({ description: 'Multiple take-profit levels for partial exits', type: [TakeProfitLevel] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  levels?: TakeProfitLevel[];
}
