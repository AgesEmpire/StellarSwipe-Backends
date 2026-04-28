import { IsNotEmpty, IsNumberString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class RecordCompetitionTradeDto {
  @IsUUID()
  @IsNotEmpty()
  userId!: string;

  @IsNumberString()
  volume!: string;

  @IsNumberString()
  realizedPnl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  assetPair?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalTradeId?: string;
}
