import { IsString, Length } from 'class-validator';

export class CurrencyPreferenceDto {
  @IsString()
  @Length(3, 10)
  preferredCurrency: string;
}
