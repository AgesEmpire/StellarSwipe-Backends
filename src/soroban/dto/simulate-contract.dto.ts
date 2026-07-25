import {
  IsArray,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsStellarPublicKey,
  IsStellarSecretKey,
} from '../../common/decorators/validation.decorator';
import { IsSorobanContractAddress } from '../../common/decorators/is-soroban-contract-address.decorator';

export class SimulateContractDto {
  @ApiProperty({ description: 'Soroban contract ID (StrKey C… address)' })
  @IsString()
  @IsSorobanContractAddress()
  contractId!: string;

  @ApiProperty({ description: 'Contract method / function name to invoke' })
  @IsString()
  method!: string;

  @ApiPropertyOptional({
    description: 'Arguments for the contract call. Each element is a JS value that will be converted to ScVal.',
    isArray: true,
  })
  @IsArray()
  @IsOptional()
  params?: unknown[];

  @ApiPropertyOptional({ description: 'Source account public key for simulation context' })
  @IsString()
  @IsOptional()
  @IsStellarPublicKey()
  sourceAccount?: string;

  @ApiPropertyOptional({ description: 'Source secret key — used only to build the tx envelope for simulation (never broadcast)' })
  @IsString()
  @IsOptional()
  @IsStellarSecretKey()
  sourceSecret?: string;

  @ApiPropertyOptional({ description: 'Timeout in milliseconds for the RPC call', minimum: 1 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  timeoutMs?: number;
}
