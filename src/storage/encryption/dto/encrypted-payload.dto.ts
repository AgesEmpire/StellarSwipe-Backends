import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
import {
  EncryptedPayloadAccessLevel,
  EncryptedPayloadSourceType,
} from '../entities/encrypted-payload.entity';

export class EncryptedPayloadDto {
  @IsEnum(EncryptedPayloadSourceType)
  sourceType!: EncryptedPayloadSourceType;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsString()
  ownerUserId?: string;

  @IsOptional()
  @IsEnum(EncryptedPayloadAccessLevel)
  accessLevel?: EncryptedPayloadAccessLevel;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
