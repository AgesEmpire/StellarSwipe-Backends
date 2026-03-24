import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Timeframe } from './ohlcv-query.dto';

export class IndicatorsQueryDto {
  @IsEnum(Timeframe)
  @IsOptional()
  timeframe?: Timeframe = Timeframe.ONE_HOUR;

  @IsInt()
  @Min(50)
  @Max(500)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 200;
}
