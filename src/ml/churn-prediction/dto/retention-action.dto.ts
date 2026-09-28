import { IsString, IsEnum, IsOptional } from 'class-validator';

export enum RetentionActionType {
  EMAIL = 'email',
  PUSH = 'push',
  DISCOUNT = 'discount',
  PERSONAL_OUTREACH = 'personal_outreach',
}

export class RetentionActionDto {
  @IsString()
  userId: string;

  @IsEnum(RetentionActionType)
  actionType: RetentionActionType;

  @IsOptional()
  @IsString()
  message?: string;
}
