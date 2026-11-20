import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { TaxJurisdiction } from '../tax-report.types';

export class TaxReportQueryDto {
  @IsInt()
  taxYear: number;

  @IsEnum(['FIFO', 'LIFO'])
  method: 'FIFO' | 'LIFO';

  @IsString()
  @IsOptional()
  format?: 'CSV' | 'PDF';

  @IsEnum(['US', 'EU', 'NG'])
  jurisdiction: TaxJurisdiction;
}
