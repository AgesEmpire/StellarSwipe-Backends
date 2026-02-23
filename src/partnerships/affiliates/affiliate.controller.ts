import { Controller, Get, Post, Body, Param, UseGuards, Request } from '@nestjs/common';
import { AffiliateService } from './affiliate.service';
import { CreateAffiliateDto } from './dto/create-affiliate.dto';
import { TrackConversionDto } from './dto/track-conversion.dto';

@Controller('affiliates')
export class AffiliateController {
  constructor(private readonly affiliateService: AffiliateService) {}

  @Post()
  async createAffiliate(@Body() dto: CreateAffiliateDto) {
    return this.affiliateService.createAffiliate(dto);
  }

  @Get('code/:code')
  async getAffiliateByCode(@Param('code') code: string) {
    return this.affiliateService.getAffiliateByCode(code);
  }

  @Get('user/:userId')
  async getAffiliateByUserId(@Param('userId') userId: string) {
    return this.affiliateService.getAffiliateByUserId(userId);
  }

  @Post('conversions')
  async trackConversion(@Body() dto: TrackConversionDto) {
    return this.affiliateService.trackConversion(dto);
  }

  @Post('conversions/:id/approve')
  async approveConversion(@Param('id') id: string) {
    return this.affiliateService.approveConversion(id);
  }

  @Get(':id/stats')
  async getAffiliateStats(@Param('id') id: string) {
    return this.affiliateService.getAffiliateStats(id);
  }

  @Post(':id/payout')
  async processPayout(@Param('id') id: string) {
    return this.affiliateService.processPayout(id);
  }

  @Get('dashboard/:userId')
  async getPartnerDashboard(@Param('userId') userId: string) {
    return this.affiliateService.getPartnerDashboard(userId);
  }
}
