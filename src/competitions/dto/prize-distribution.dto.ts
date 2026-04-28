import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsUUID, Min, Max } from 'class-validator';

export class PrizePlacementDto {
  @IsNumber()
  @Min(1)
  rank!: number;

  @IsNumber()
  @Min(0)
  @Max(1)
  share!: number;
}

export class PrizeDistributionDto {
  @IsUUID()
  @IsNotEmpty()
  competitionId!: string;

  @IsArray()
  placements!: PrizePlacementDto[];

  @IsOptional()
  notes?: string;
}
