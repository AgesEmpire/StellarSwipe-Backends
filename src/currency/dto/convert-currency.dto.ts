import { IsString, IsNumber, IsPositive, Length } from 'class-validator';

export class ConvertCurrencyDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  @Length(3, 10)
  from: string;

  @IsString()
  @Length(3, 10)
  to: string;
}
