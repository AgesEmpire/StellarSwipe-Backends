import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { InvalidateSessionDto } from './dto/invalidate-session.dto';
import {
  SessionInvalidationActor,
  SessionInvalidationService,
} from './session-invalidation.service';

type SessionInvalidationRequest = Request & {
  user?: SessionInvalidationActor;
};

@ApiTags('auth-sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('auth/sessions')
export class SessionController {
  constructor(
    private readonly sessionInvalidationService: SessionInvalidationService,
  ) {}

  @Post('invalidate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Invalidate a user session or all sessions for a user',
  })
  @ApiResponse({ status: 200, description: 'Session invalidated' })
  @ApiResponse({ status: 403, description: 'Admin access is required' })
  @ApiResponse({ status: 404, description: 'Session not found' })
  invalidate(
    @Body() dto: InvalidateSessionDto,
    @Req() req: SessionInvalidationRequest,
  ) {
    return this.sessionInvalidationService.invalidate(dto, req.user, {
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestId: req.get('x-request-id'),
    });
  }
}
