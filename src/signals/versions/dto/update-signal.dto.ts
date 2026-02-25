import {
  IsOptional,
  IsString,
  IsBoolean,
  MaxLength,
  Matches,
} from 'class-validator';

export class UpdateSignalDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, {
    message: 'targetPrice must be a valid decimal with up to 8 decimal places',
  })
  targetPrice?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, {
    message:
      'stopLossPrice must be a valid decimal with up to 8 decimal places',
  })
  stopLossPrice?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,8})?$/, {
    message: 'entryPrice must be a valid decimal with up to 8 decimal places',
  })
  entryPrice?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;
}

export class CopierApprovalDto {
  @IsBoolean()
  approved: boolean;

  @IsOptional()
  @IsBoolean()
  autoAdjust?: boolean;
}
