import { IsString, IsArray, IsEnum, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { NftType, NftRarity, MetadataAttribute } from '../interfaces/metadata-schema.interface';

export class MetadataAttributeDto {
  @IsString()
  trait_type: string;

  @IsString()
  value: string | number;
}

export class NftMetadataDto {
  @IsString()
  name: string;

  @IsString()
  description: string;

  @IsString()
  image: string;

  @IsEnum(['achievement', 'trophy', 'milestone'])
  type: NftType;

  @IsEnum(['common', 'rare', 'epic', 'legendary'])
  rarity: NftRarity;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MetadataAttributeDto)
  attributes: MetadataAttribute[];

  @IsString()
  @IsOptional()
  external_url?: string;
}
