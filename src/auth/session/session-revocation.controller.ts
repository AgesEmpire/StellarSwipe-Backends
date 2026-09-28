import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { SessionRevocationService } from './session-revocation.service';

/**
 * Not wired into AuthModule yet - exposes revocation endpoints for
 * review; mount alongside the existing session controller once approved.
 */
@Controller('auth/sessions')
export class SessionRevocationController {
  constructor(private readonly sessionRevocationService: SessionRevocationService) {}

  @Get(':userId')
  listActive(@Param('userId') userId: string) {
    return this.sessionRevocationService.getActiveSessions(userId);
  }

  @Delete(':sessionId')
  revokeOne(@Param('sessionId') sessionId: string) {
    const revoked = this.sessionRevocationService.revokeSession(sessionId);
    return { revoked };
  }

  @Post('revoke-all')
  revokeAll(@Body() body: { userId: string; exceptSessionId?: string }) {
    const count = this.sessionRevocationService.revokeAllForUser(body.userId, body.exceptSessionId);
    return { revokedCount: count };
  }
}
