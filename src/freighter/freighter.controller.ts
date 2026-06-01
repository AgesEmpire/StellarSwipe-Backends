import {
  Controller,
  Post,
  Body,
  Delete,
  Query,
  UseGuards,
  Request,
} from '@nestjs/common';
import { FreighterService } from './freighter.service';
import {
  FreighterChallengeDto,
  FreighterVerifyDto,
  FreighterActionDto,
} from './dto/freighter.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('auth/freighter')
export class FreighterController {
  constructor(private readonly freighterService: FreighterService) {}

  @Post('challenge')
  issueChallenge(@Body() dto: FreighterChallengeDto) {
    return this.freighterService.issueChallenge(dto);
  }

  @Post('verify')
  verify(@Body() dto: FreighterVerifyDto, @Request() req: any) {
    return this.freighterService.verifyAndCreateSession(dto, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @UseGuards(JwtAuthGuard)
  @Post('validate-action')
  validateAction(@Body() dto: FreighterActionDto) {
    return this.freighterService.validateSensitiveAction(dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('session')
  revokeSession(@Query('sessionId') sessionId: string) {
    return this.freighterService.revokeSession(sessionId);
  }
}
