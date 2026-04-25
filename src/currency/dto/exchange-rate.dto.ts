import { IsString, Length } from 'class-validator';

export class ExchangeRateDto {
  @IsString()
  @Length(3, 10)
  base: string;

  @IsString()
  @Length(3, 10)
  quote: string;
}
