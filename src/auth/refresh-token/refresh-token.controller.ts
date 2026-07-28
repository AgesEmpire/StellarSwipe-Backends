import { Body, Controller, Post } from '@nestjs/common';
import { RefreshTokenService } from './refresh-token.service';

class IssueTokenDto {
  userId: string;
}

class RefreshTokenDto {
  refreshToken: string;
}

class RevokeTokenDto {
  refreshToken: string;
}

@Controller('auth/refresh-token')
export class RefreshTokenController {
  constructor(private readonly refreshTokenService: RefreshTokenService) {}

  @Post('issue')
  issue(@Body() dto: IssueTokenDto) {
    return this.refreshTokenService.issue(dto.userId);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.refreshTokenService.refresh(dto.refreshToken);
  }

  @Post('revoke')
  revoke(@Body() dto: RevokeTokenDto) {
    this.refreshTokenService.revoke(dto.refreshToken);
    return { revoked: true };
  }
}
