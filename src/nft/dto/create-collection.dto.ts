import { IsInt, IsOptional, IsPositive, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCollectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name: string;

  @IsString()
  @MinLength(1)
  @MaxLength(20)
  symbol: string;

  @IsOptional()
  @IsString()
  contractId?: string;

  @IsOptional()
  @IsInt()
  @IsPositive()
  maxSupply?: number;
}
