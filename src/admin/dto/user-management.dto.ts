import { IsOptional, IsString, IsEnum, IsBoolean, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';

export enum UserSortOptions {
    CREATED_AT = 'createdAt',
    REPUTATION = 'reputation',
    LAST_LOGIN = 'lastLoginAt'
}

export class UserManagementQueryDto {
    @IsOptional()
    @IsString()
    search?: string;

    @IsOptional()
    @IsBoolean()
    @Type(() => Boolean)
    isActive?: boolean;

    @IsOptional()
    @IsEnum(UserSortOptions)
    sortBy?: UserSortOptions = UserSortOptions.CREATED_AT;

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

export class SuspendUserDto {
    @IsString()
    reason!: string;

    @IsOptional()
    @Type(() => Number)
    durationDays?: number; // Optional temporary suspension
}
