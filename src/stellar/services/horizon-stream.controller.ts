import { Controller, Post, Delete, Get, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { HorizonStreamService } from '../services/horizon-stream.service';
import { WatchAccountsDto } from './dto/watch-accounts.dto';

@ApiTags('Horizon Stream')
@Controller('api/v1/horizon-stream')
export class HorizonStreamController {
  constructor(private readonly horizonStreamService: HorizonStreamService) {}

  @Post('watch/:publicKey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start watching an account for events' })
  @ApiParam({ name: 'publicKey', description: 'Account public key to watch' })
  @ApiResponse({ status: 200, description: 'Account added to watch list' })
  @ApiResponse({ status: 400, description: 'Invalid public key' })
  async watchAccount(@Param('publicKey') publicKey: string) {
    await this.horizonStreamService.addWatchedAccount(publicKey);
    return {
      success: true,
      message: `Started watching account: ${publicKey}`,
    };
  }

  @Delete('watch/:publicKey')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop watching an account for events' })
  @ApiParam({ name: 'publicKey', description: 'Account public key to stop watching' })
  @ApiResponse({ status: 200, description: 'Account removed from watch list' })
  async unwatchAccount(@Param('publicKey') publicKey: string) {
    await this.horizonStreamService.removeWatchedAccount(publicKey);
    return {
      success: true,
      message: `Stopped watching account: ${publicKey}`,
    };
  }

  @Get('status')
  @ApiOperation({ summary: 'Get streaming service status' })
  @ApiResponse({ status: 200, description: 'Stream status retrieved' })
  getStreamStatus() {
    return this.horizonStreamService.getStreamStatus();
  }

  @Post('watch-multiple')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start watching multiple accounts for events' })
  @ApiResponse({ status: 200, description: 'Accounts added to watch list' })
  async watchMultipleAccounts(@Body() body: WatchAccountsDto) {
    const { publicKeys } = body;
    
    for (const publicKey of publicKeys) {
      await this.horizonStreamService.addWatchedAccount(publicKey);
    }
    
    return {
      success: true,
      message: `Started watching ${publicKeys.length} accounts`,
      accounts: publicKeys,
    };
  }
}