import { IsString, IsNotEmpty, IsEnum, IsOptional, IsNumber } from 'class-validator';

export enum ActionType {
  EXECUTE_TRADE = 'execute_trade',
  CREATE_SIGNAL = 'create_signal',
  GET_PORTFOLIO = 'get_portfolio',
}

export class ActionConfigDto {
  @IsEnum(ActionType)
  action: ActionType;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsString()
  signalId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsString()
  symbol?: string;
}
