import {
  IsUrl,
  IsArray,
  ArrayNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsIn,
} from 'class-validator';
import {
  MANDATORY_WEBHOOK_EVENTS,
  SUPPORTED_WEBHOOK_EVENTS,
  WebhookEventType,
} from '../entities/webhook.entity';

export class RegisterWebhookDto {
  @IsUrl({ require_tld: false, require_protocol: true })
  url!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(SUPPORTED_WEBHOOK_EVENTS, { each: true })
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
  @IsIn(SUPPORTED_WEBHOOK_EVENTS, { each: true })
  events?: WebhookEventType[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export { SUPPORTED_WEBHOOK_EVENTS, MANDATORY_WEBHOOK_EVENTS };
