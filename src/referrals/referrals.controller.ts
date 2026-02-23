import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ReferralsService } from './referrals.service';
import { ClaimReferralDto } from './dto/claim-referral.dto';
import { ReferralStatsDto } from './dto/referral-stats.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('referrals')
@UseGuards(JwtAuthGuard)
export class ReferralsController {
  constructor(private readonly referralsService: ReferralsService) {}

  @Get('code')
  async getReferralCode(@Request() req: any): Promise<{ referralCode: string }> {
    const userId = req.user.userId;
    const referralCode = await this.referralsService.getUserReferralCode(userId);
    return { referralCode };
  }

  @Post('claim')
  async claimReferral(
    @Request() req: any,
    @Body() claimReferralDto: ClaimReferralDto,
  ): Promise<{ message: string; referralId: string }> {
    const userId = req.user.userId;
    const referral = await this.referralsService.claimReferral(
      userId,
      claimReferralDto.referralCode,
    );
    return {
      message: 'Referral claimed successfully',
      referralId: referral.id,
    };
  }

  @Get('stats')
  async getReferralStats(@Request() req: any): Promise<ReferralStatsDto> {
    const userId = req.user.userId;
    return this.referralsService.getReferralStats(userId);
  }
}
