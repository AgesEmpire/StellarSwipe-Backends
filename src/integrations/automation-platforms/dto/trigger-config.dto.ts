import { IsString, IsNotEmpty, IsEnum } from 'class-validator';

export enum TriggerEvent {
  NEW_SIGNAL = 'new_signal',
  TRADE_EXECUTED = 'trade_executed',
  PRICE_ALERT = 'price_alert',
}

export class TriggerConfigDto {
  @IsEnum(TriggerEvent)
  event: TriggerEvent;

  @IsString()
  @IsNotEmpty()
  hookUrl: string;
}
