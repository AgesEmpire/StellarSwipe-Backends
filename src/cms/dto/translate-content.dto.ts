import { IsString, IsOptional, MinLength, Length } from 'class-validator';

export class TranslateContentDto {
  @IsString()
  @Length(2, 10)
  locale!: string;

  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  @IsOptional()
  @IsString()
  translatorId?: string;
}
