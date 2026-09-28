import {
  IsDate,
  IsString,
  IsNumber,
  IsArray,
  IsOptional,
  IsEnum,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SettlementMismatchDto {
  @IsString()
  tradeId: string;

  @IsString()
  expectedAmount: string;

  @IsString()
  actualAmount: string;
}

export class ReconciliationReportDto {
  @IsString()
  reportId: string;

  @IsDate()
  periodStart: Date;

  @IsDate()
  periodEnd: Date;

  @IsNumber()
  totalTrades: number;

  @IsNumber()
  totalSettlements: number;

  @IsArray()
  @IsString({ each: true })
  missingSettlements: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SettlementMismatchDto)
  mismatchedSettlements: SettlementMismatchDto[];

  @IsNumber()
  @Min(0)
  discrepancyCount: number;

  @IsEnum(['clean', 'discrepancies_found'])
  status: 'clean' | 'discrepancies_found';

  @IsDate()
  generatedAt: Date;
}

export class ReconciliationPeriodDto {
  @IsDate()
  @Type(() => Date)
  startDate: Date;

  @IsDate()
  @Type(() => Date)
  endDate: Date;
}
