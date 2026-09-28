import { IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';

export class UploadAbiDto {
  @IsString()
  @IsNotEmpty()
  contractName!: string;

  @IsString()
  @IsNotEmpty()
  network!: string;

  @IsOptional()
  @IsString()
  version?: string;

  @IsObject()
  abi!: unknown;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
