import { IsNotEmpty, IsString } from 'class-validator';

export class GetPriceDto {
  @IsString()
  @IsNotEmpty()
  assetPair: string;
}
