import { Controller, Post, Get, Delete, Body, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { TrustlineService } from './trustline.service';
import { CreateTrustlineDto } from './dto/create-trustline.dto';
import { TrustlineStatusDto } from './dto/trustline-status.dto';

@ApiTags('Trustlines')
@Controller('api/v1/trustlines')
export class TrustlineController {
  constructor(private readonly trustlineService: TrustlineService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new trustline' })
  @ApiResponse({ status: 201, description: 'Trustline created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid request or insufficient reserves' })
  @ApiResponse({ status: 409, description: 'Trustline already exists' })
  async createTrustline(@Body() createTrustlineDto: CreateTrustlineDto) {
    return this.trustlineService.createTrustline(createTrustlineDto);
  }

  @Delete(':publicKey/:assetCode/:assetIssuer')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove a trustline' })
  @ApiParam({ name: 'publicKey', description: 'Account public key' })
  @ApiParam({ name: 'assetCode', description: 'Asset code (e.g., USDC)' })
  @ApiParam({ name: 'assetIssuer', description: 'Asset issuer public key' })
  @ApiResponse({ status: 200, description: 'Trustline removed successfully' })
  @ApiResponse({ status: 400, description: 'Cannot remove trustline with balance or trustline not found' })
  async removeTrustline(
    @Param('publicKey') publicKey: string,
    @Param('assetCode') assetCode: string,
    @Param('assetIssuer') assetIssuer: string,
    @Query('secretKey') secretKey: string,
  ) {
    return this.trustlineService.removeTrustline(publicKey, secretKey, assetCode, assetIssuer);
  }

  @Get(':publicKey/status')
  @ApiOperation({ summary: 'Get trustline status for an account' })
  @ApiParam({ name: 'publicKey', description: 'Account public key' })
  @ApiResponse({ status: 200, description: 'Trustline status retrieved', type: TrustlineStatusDto })
  @ApiResponse({ status: 400, description: 'Invalid public key or account not found' })
  async getTrustlineStatus(@Param('publicKey') publicKey: string): Promise<TrustlineStatusDto> {
    return this.trustlineService.getTrustlineStatus(publicKey);
  }

  @Post('check-before-trade')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check if trustline exists before trade execution' })
  @ApiResponse({ status: 200, description: 'Trustline check completed' })
  async checkTrustlineBeforeTrade(
    @Body() body: { publicKey: string; assetCode: string; assetIssuer: string }
  ) {
    const { publicKey, assetCode, assetIssuer } = body;
    const asset = assetCode === 'XLM' 
      ? new (await import('stellar-sdk')).Asset.native()
      : new (await import('stellar-sdk')).Asset(assetCode, assetIssuer);
    
    return this.trustlineService.checkTrustlineBeforeTrade(publicKey, asset);
  }

  @Post('auto-create-for-trade')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Automatically create trustline for trade if needed' })
  @ApiResponse({ status: 201, description: 'Trustline created or already exists' })
  @ApiResponse({ status: 400, description: 'Cannot create trustline' })
  async autoCreateTrustlineForTrade(
    @Body() body: { publicKey: string; secretKey: string; assetCode: string; assetIssuer: string }
  ) {
    const { publicKey, secretKey, assetCode, assetIssuer } = body;
    const asset = assetCode === 'XLM' 
      ? new (await import('stellar-sdk')).Asset.native()
      : new (await import('stellar-sdk')).Asset(assetCode, assetIssuer);
    
    return this.trustlineService.autoCreateTrustlineForTrade(publicKey, secretKey, asset);
  }
}