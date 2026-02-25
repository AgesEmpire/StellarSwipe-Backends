import { IsString, IsOptional, IsEnum, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export enum SignalModerationSortOptions {
    CREATED_AT = 'createdAt',
    REPORTS_COUNT = 'reportsCount',
    RISK_SCORE = 'riskScore'
}

export class SignalModerationQueryDto {
    @IsOptional()
    @IsUUID()
    providerId?: string;

    @IsOptional()
    @IsEnum(SignalModerationSortOptions)
    sortBy?: SignalModerationSortOptions = SignalModerationSortOptions.CREATED_AT;

    @IsOptional()
    @IsEnum(['ASC', 'DESC'])
    order?: 'ASC' | 'DESC' = 'DESC';

    @IsOptional()
    @Type(() => Number)
    page?: number = 1;

    @IsOptional()
    @Type(() => Number)
    limit?: number = 20;
}

export class RemoveSignalDto {
    @IsString()
    reason!: string;
}
