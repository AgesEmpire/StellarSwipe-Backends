import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';

export class CreateDocumentVersionDto {
  @IsString()
  @MaxLength(20)
  version!: string;

  @IsString()
  content!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  changelog?: string;

  @IsOptional()
  @IsBoolean()
  requiresReacceptance?: boolean;
}

export class PublishVersionDto {
  @IsOptional()
  @IsBoolean()
  requiresReacceptance?: boolean;
}
