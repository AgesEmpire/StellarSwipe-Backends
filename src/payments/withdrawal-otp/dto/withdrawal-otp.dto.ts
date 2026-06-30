import { IsUUID, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RequestWithdrawalOtpDto {
  @ApiProperty({ description: 'The withdrawal request ID requiring OTP confirmation' })
  @IsUUID()
  withdrawalRequestId: string;
}

export class VerifyWithdrawalOtpDto {
  @ApiProperty({ description: 'The withdrawal request ID' })
  @IsUUID()
  withdrawalRequestId: string;

  @ApiProperty({ description: 'The 6-digit OTP code' })
  @IsString()
  @Length(6, 6)
  otp: string;
}
