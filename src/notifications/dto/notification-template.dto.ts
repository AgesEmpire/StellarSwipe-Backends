import { IsString, IsOptional, IsArray, IsBoolean } from 'class-validator';

export class CreateNotificationTemplateDto {
  @IsString()
  name: string;

  @IsString()
  key: string;

  @IsOptional()
  @IsString()
  emailSubject?: string;

  @IsOptional()
  @IsString()
  emailBody?: string;

  @IsOptional()
  @IsString()
  smsBody?: string;

  @IsOptional()
  @IsString()
  inAppTitle?: string;

  @IsOptional()
  @IsString()
  inAppBody?: string;

  @IsOptional()
  @IsString()
  pushTitle?: string;

  @IsOptional()
  @IsString()
  pushBody?: string;

  @IsOptional()
  @IsString()
  fallbackTitle?: string;

  @IsOptional()
  @IsString()
  fallbackMessage?: string;

  @IsOptional()
  @IsArray()
  variables?: string[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class RenderTemplateDto {
  @IsString()
  templateKey: string;

  @IsArray()
  variables: Record<string, any>;
}
