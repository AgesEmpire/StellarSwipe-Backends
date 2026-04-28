import {
  IsUrl,
  IsArray,
  ArrayNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
} from 'class-validator';
import { SUPPORTED_WEBHOOK_EVENTS, WebhookEventType } from '../entities/webhook.entity';

export class RegisterWebhookDto {
  @IsUrl({ require_tld: false, require_protocol: true })
  url!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events!: WebhookEventType[];

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false, require_protocol: true })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  events?: WebhookEventType[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export { SUPPORTED_WEBHOOK_EVENTS };
