import {
    IsBoolean,
    IsEnum,
    IsOptional,
    IsString,
    IsNumber,
    Min,
    Max,
    Length,
} from 'class-validator';
import { RiskLevel } from '../entities/user-preference.entity';

export class UpdatePreferenceDto {
    @IsOptional()
    @IsBoolean()
    emailNotifications?: boolean;

    @IsOptional()
    @IsBoolean()
    pushNotifications?: boolean;

    @IsOptional()
    @IsBoolean()
    tradeNotifications?: boolean;

    @IsOptional()
    @IsEnum(RiskLevel)
    riskLevel?: RiskLevel;

    @IsOptional()
    @IsString()
    @Length(2, 10)
    language?: string;

    @IsOptional()
    @IsString()
    @Length(3, 10)
    preferredCurrency?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    defaultSlippagePercent?: number;
}
