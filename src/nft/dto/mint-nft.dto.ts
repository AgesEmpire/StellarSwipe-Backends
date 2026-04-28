import { IsString, IsUUID, IsOptional, IsEnum } from 'class-validator';
import { NftType, NftRarity } from '../interfaces/metadata-schema.interface';

export class MintNftDto {
  @IsUUID()
  userId: string;

  @IsString()
  ownerWallet: string;

  @IsUUID()
  collectionId: string;

  @IsEnum(['achievement', 'trophy', 'milestone'])
  type: NftType;

  @IsEnum(['common', 'rare', 'epic', 'legendary'])
  @IsOptional()
  rarity?: NftRarity;

  @IsString()
  @IsOptional()
  achievementKey?: string;

  @IsString()
  @IsOptional()
  sourceSecret?: string;
}
