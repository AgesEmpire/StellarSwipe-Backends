import {
  Controller,
  Post,
  Body,
  Param,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { SessionInvalidationService } from './session-invalidation.service';
import {
  InvalidateSessionDto,
  InvalidateSessionResponseDto,
  AdminSessionActionDto,
} from './dto/invalidate-session.dto';

@Controller('auth/sessions')
@UseGuards(JwtAuthGuard)
export class SessionController {
  constructor(
    private readonly sessionInvalidationService: SessionInvalidationService,
  ) {}

  @Post('invalidate')
  @HttpCode(200)
  invalidate(@Body() dto: InvalidateSessionDto): Promise<InvalidateSessionResponseDto> {
    return this.sessionInvalidationService.invalidate(dto);
  }

  @Post('invalidate/session/:sessionId')
  @HttpCode(200)
  invalidateBySessionId(
    @Param('sessionId') sessionId: string,
    @Body() body: AdminSessionActionDto,
  ): Promise<InvalidateSessionResponseDto> {
    return this.sessionInvalidationService.invalidateBySessionId(
      sessionId,
      body.adminId,
      body.reason,
    );
  }

  @Post('invalidate/user/:userId')
  @HttpCode(200)
  invalidateByUserId(
    @Param('userId') userId: string,
    @Body() body: AdminSessionActionDto,
  ): Promise<InvalidateSessionResponseDto> {
    return this.sessionInvalidationService.invalidateByUserId(
      userId,
      body.adminId,
      body.reason,
    );
  }
}
