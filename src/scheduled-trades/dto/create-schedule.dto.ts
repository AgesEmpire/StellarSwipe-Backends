import {
  IsEnum,
  IsOptional,
  IsNumber,
  IsString,
  IsDate,
  IsUUID,
  Min,
  ValidateNested,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ScheduleType,
  PriceConditionType,
  RecurrenceType,
} from '../entities/scheduled-trade.entity';

export class ScheduleConditionsDto {
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  executeAt?: Date;

  @IsOptional()
  @IsNumber()
  @Min(0)
  targetPrice?: number;

  @IsOptional()
  @IsEnum(PriceConditionType)
  priceCondition?: PriceConditionType;

  @IsOptional()
  @IsEnum(RecurrenceType)
  recurrence?: RecurrenceType;

  @IsOptional()
  @IsString()
  @Matches(/^\d{2}:\d{2}$/, { message: 'recurTime must be in HH:mm format' })
  recurTime?: string;
}

export class CreateScheduleDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsUUID()
  signalId?: string;

  @IsString()
  assetPair!: string;

  @IsEnum(ScheduleType)
  scheduleType!: ScheduleType;

  @ValidateNested()
  @Type(() => ScheduleConditionsDto)
  conditions!: ScheduleConditionsDto;

  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}
