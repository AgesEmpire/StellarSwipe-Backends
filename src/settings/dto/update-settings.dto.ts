import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class TradingSettingsDto {
  @IsEnum(['market', 'limit'])
  @IsOptional()
  defaultOrderType?: 'market' | 'limit';

  @IsNumber()
  @Min(0.1)
  @Max(10)
  @IsOptional()
  defaultSlippage?: number;

  @IsBoolean()
  @IsOptional()
  confirmTrades?: boolean;
}

class RiskSettingsDto {
  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  maxOpenPositions?: number;

  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  maxExposure?: number;

  @IsBoolean()
  @IsOptional()
  requireStopLoss?: boolean;
}

class DisplaySettingsDto {
  @IsEnum(['light', 'dark'])
  @IsOptional()
  theme?: 'light' | 'dark';

  @IsString()
  @IsOptional()
  language?: string;

  @IsString()
  @IsOptional()
  currency?: string;
}

class NotificationSettingsDto {
  @IsBoolean()
  @IsOptional()
  email?: boolean;

  @IsBoolean()
  @IsOptional()
  push?: boolean;

  @IsBoolean()
  @IsOptional()
  tradeFills?: boolean;

  @IsBoolean()
  @IsOptional()
  priceAlerts?: boolean;

  @IsBoolean()
  @IsOptional()
  systemUpdates?: boolean;
}

export class UpdateSettingsDto {
  /**
   * Version last read by the client. If supplied, the update is rejected
   * with a 409 conflict when the settings were modified since that read.
   */
  @IsNumber()
  @IsOptional()
  expectedVersion?: number;

  @IsObject()
  @ValidateNested()
  @Type(() => TradingSettingsDto)
  @IsOptional()
  trading?: TradingSettingsDto;

  @IsObject()
  @ValidateNested()
  @Type(() => RiskSettingsDto)
  @IsOptional()
  risk?: RiskSettingsDto;

  @IsObject()
  @ValidateNested()
  @Type(() => DisplaySettingsDto)
  @IsOptional()
  display?: DisplaySettingsDto;

  @IsObject()
  @ValidateNested()
  @Type(() => NotificationSettingsDto)
  @IsOptional()
  notifications?: NotificationSettingsDto;
}
