import { Controller, Post, Get, Body } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SponsoredReservesService } from './sponsored-reserves.service';
import { SponsoredOnboardingDto, RevokeSponsorshipDto } from './sponsored-reserves.dto';

@ApiTags('Sponsored Reserves')
@Controller('stellar/sponsored-reserves')
export class SponsoredReservesController {
  constructor(private readonly sponsoredReservesService: SponsoredReservesService) {}

  @Post('onboard')
  @ApiOperation({ summary: 'Sponsor a new user account creation and initial trustlines' })
  onboard(
    @Body() body: SponsoredOnboardingDto & { newAccountSecretKey: string },
  ) {
    const { newAccountSecretKey, ...dto } = body;
    return this.sponsoredReservesService.sponsorNewAccountOnboarding(dto, newAccountSecretKey);
  }

  @Post('revoke')
  @ApiOperation({ summary: 'Revoke sponsorship of a sponsored account reserve' })
  revoke(@Body() dto: RevokeSponsorshipDto) {
    return this.sponsoredReservesService.revokeSponsoredAccountReserve(dto);
  }

  @Get('capacity')
  @ApiOperation({ summary: 'Check sponsor reserve capacity for onboarding' })
  capacity() {
    return this.sponsoredReservesService.getSponsorReserveCapacity();
  }
}
