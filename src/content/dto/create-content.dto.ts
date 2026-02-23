import {
  IsString,
  IsEnum,
  IsArray,
  IsOptional,
  IsBoolean,
  IsUrl,
  MaxLength,
  MinLength,
  ArrayMaxSize,
} from 'class-validator';
import { ContentType } from '../entities/provider-content.entity';

export class CreateContentDto {
  @IsEnum(ContentType)
  type: ContentType;

  @IsString()
  @MinLength(5)
  @MaxLength(200)
  title: string;

  @IsString()
  @MinLength(10)
  body: string; // markdown for articles, description for videos

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  @IsOptional()
  tags?: string[];

  @IsBoolean()
  @IsOptional()
  published?: boolean;

  @IsUrl()
  @IsOptional()
  thumbnailUrl?: string;

  @IsUrl()
  @IsOptional()
  videoUrl?: string; // Required for video type
}
