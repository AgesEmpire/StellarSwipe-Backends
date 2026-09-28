import { IsString, IsNotEmpty, IsObject, IsEnum } from 'class-validator';
import { TriggerEvent } from './trigger-config.dto';

export class WebhookPayloadDto {
  @IsEnum(TriggerEvent)
  event: TriggerEvent;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsObject()
  data: Record<string, unknown>;

  @IsString()
  timestamp: string;
}
