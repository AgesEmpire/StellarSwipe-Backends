import { IsArray, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class InvokeContractDto {
  @IsString()
  contractId!: string;

  @IsString()
  method!: string;

  @IsArray()
  @IsOptional()
  params?: unknown[];

  @IsString()
  @IsOptional()
  sourceSecret?: string;

  @IsString()
  @IsOptional()
  sourceAccount?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  timeoutMs?: number;
}
