import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { StakeVerificationService } from './services/stake-verification.service';
import { VerificationMonitorJob } from './services/verification-monitor.job';
import {
  VerifyStakeDto,
  StakeVerificationResponse,
  VerificationStatusDto,
} from './dto/verify-stake.dto';

// Uncomment when you have authentication guards
// import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Provider Verification')
@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly stakeVerificationService: StakeVerificationService,
    private readonly verificationMonitor: VerificationMonitorJob,
  ) {}

  @Post('verify-stake')
  @HttpCode(HttpStatus.OK)
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({
    summary: 'Verify provider stake and grant verification badge',
    description:
      'Checks the provider\'s stake on Soroban blockchain. If stake >= 1000 XLM, grants verification badge.',
  })
  @ApiResponse({
    status: 200,
    description: 'Stake verification completed',
    type: StakeVerificationResponse,
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid public key format',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to verify stake',
  })
  async verifyStake(@Body() dto: VerifyStakeDto): Promise<StakeVerificationResponse> {
    return this.stakeVerificationService.verifyProviderStake(dto);
  }

  @Get('verification-status/:publicKey')
  @ApiOperation({
    summary: 'Get verification status for a provider',
    description: 'Returns the current verification status, stake amount, and last check time',
  })
  @ApiParam({
    name: 'publicKey',
    description: 'Stellar public key of the provider',
    example: 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification status retrieved',
    type: VerificationStatusDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Provider not found',
  })
  async getVerificationStatus(
    @Param('publicKey') publicKey: string,
  ): Promise<VerificationStatusDto> {
    return this.stakeVerificationService.getVerificationStatus(publicKey);
  }

  @Post('revoke-verification/:publicKey')
  @HttpCode(HttpStatus.OK)
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke verification for a provider',
    description: 'Manually revoke verification badge (admin only)',
  })
  @ApiParam({
    name: 'publicKey',
    description: 'Stellar public key of the provider',
  })
  @ApiResponse({
    status: 200,
    description: 'Verification revoked successfully',
  })
  async revokeVerification(@Param('publicKey') publicKey: string): Promise<{ message: string }> {
    await this.stakeVerificationService.revokeVerification(publicKey);
    return { message: 'Verification revoked successfully' };
  }

  @Post('monitoring/trigger')
  @HttpCode(HttpStatus.OK)
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({
    summary: 'Trigger immediate monitoring check',
    description: 'Manually trigger stake verification for all verified providers (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Monitoring check triggered',
  })
  async triggerMonitoring(): Promise<{ message: string }> {
    // Run in background to avoid timeout
    this.verificationMonitor.triggerImmediateCheck().catch((error) => {
      console.error('Background monitoring check failed:', error);
    });
    
    return { message: 'Monitoring check triggered successfully' };
  }

  @Get('monitoring/stats')
  @ApiOperation({
    summary: 'Get monitoring statistics',
    description: 'Returns statistics about the stake monitoring system',
  })
  @ApiResponse({
    status: 200,
    description: 'Monitoring statistics retrieved',
  })
  async getMonitoringStats() {
    return this.verificationMonitor.getMonitoringStats();
  }

  @Post('monitoring/check/:publicKey')
  @HttpCode(HttpStatus.OK)
  // @UseGuards(JwtAuthGuard)
  // @ApiBearerAuth()
  @ApiOperation({
    summary: 'Check specific provider stake',
    description: 'Manually check and update stake for a specific provider (admin only)',
  })
  @ApiParam({
    name: 'publicKey',
    description: 'Stellar public key of the provider',
  })
  @ApiResponse({
    status: 200,
    description: 'Provider stake checked',
  })
  async checkProviderStake(@Param('publicKey') publicKey: string): Promise<{ message: string }> {
    await this.verificationMonitor.checkSpecificProvider(publicKey);
    return { message: 'Provider stake check completed' };
  }
}