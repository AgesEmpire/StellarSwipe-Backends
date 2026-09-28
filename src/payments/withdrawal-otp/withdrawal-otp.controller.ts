import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WithdrawalOtpService } from './withdrawal-otp.service';
import { RequestWithdrawalOtpDto } from './dto/withdrawal-otp.dto';

@ApiTags('Withdrawal OTP')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('withdrawals/otp')
export class WithdrawalOtpController {
  constructor(private readonly withdrawalOtpService: WithdrawalOtpService) {}

  @Post('request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a one-time OTP for a pending withdrawal' })
  @ApiResponse({ status: 200, description: 'OTP sent to the user verified email/phone' })
  async requestOtp(
    @Request() req: any,
    @Body() dto: RequestWithdrawalOtpDto,
  ): Promise<{ message: string }> {
    const userId: string = req.user.id;
    const userEmail: string = req.user.email;

    await this.withdrawalOtpService.requestOtp(
      userId,
      dto.withdrawalRequestId,
      userEmail,
    );

    return { message: 'OTP sent to your verified email address.' };
  }
}
