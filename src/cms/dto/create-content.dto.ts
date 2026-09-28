import { IsString, IsEnum, IsOptional, IsObject, MinLength } from 'class-validator';
import { ContentType } from '../entities/content.entity';

export class CreateContentDto {
  @IsString()
  @MinLength(3)
  slug!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsEnum(ContentType)
  type!: ContentType;

  @IsOptional()
  @IsString()
  defaultLocale?: string;

  @IsString()
  authorId!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
