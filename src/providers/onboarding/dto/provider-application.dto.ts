import {
  IsUUID,
  IsString,
  IsInt,
  IsArray,
  IsOptional,
  IsUrl,
  MinLength,
  Min,
  IsObject,
} from 'class-validator';

export class CreateProviderApplicationDto {
  @IsUUID()
  providerId: string;

  @IsString()
  @MinLength(3)
  displayName: string;

  @IsString()
  bio: string;

  @IsInt()
  @Min(0)
  tradingExperienceYears: number;

  @IsArray()
  @IsUrl({}, { each: true })
  documentUrls: string[];

  @IsOptional()
  @IsUrl()
  websiteUrl?: string;

  @IsOptional()
  @IsObject()
  socialLinks?: Record<string, string>;
}
