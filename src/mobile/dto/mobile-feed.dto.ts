import { IsString, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class MobileFeedDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  syncToken?: string;
}

export class CompactSignalDto {
  id: string;
  sym: string;       // symbol (compact key)
  dir: 'B' | 'S';   // BUY/SELL
  ep: number;        // entry price
  tp: number;        // take profit
  sl: number;        // stop loss
  ts: number;        // unix timestamp
  pnl?: number;
}
