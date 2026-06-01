import { Controller, Get, Post, Delete, Request, UseGuards, Query } from '@nestjs/common';
import { WalletStatusService } from './wallet-status.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('wallet')
export class WalletStatusController {
  constructor(private readonly walletStatusService: WalletStatusService) {}

  @Get('status')
  getStatus(
    @Query('sessionId') sessionId: string,
    @Query('walletAddress') walletAddress: string,
    @Query('walletProvider') walletProvider: string,
  ) {
    return this.walletStatusService.getStatus(sessionId, walletAddress, walletProvider);
  }

  @UseGuards(JwtAuthGuard)
  @Post('refresh')
  refresh(@Request() req: any, @Query('sessionId') sessionId: string) {
    return this.walletStatusService.refresh(sessionId, req.user.publicKey ?? '');
  }

  @UseGuards(JwtAuthGuard)
  @Delete('disconnect')
  disconnect(@Query('sessionId') sessionId: string) {
    return this.walletStatusService.disconnect(sessionId);
  }
}
