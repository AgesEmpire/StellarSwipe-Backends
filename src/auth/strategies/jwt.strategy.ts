import {
  Injectable,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../interfaces/jwt-payload.interface';
import { UsersService } from '../../users/users.service';
import { SessionManagerService } from '../session/session-manager.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly expectedIssuer: string;
  private readonly expectedAudience: string;

  constructor(
    configService: ConfigService,
    private usersService: UsersService,
    private sessionManager: SessionManagerService,
  ) {
    const issuer = configService.get<string>('jwt.issuer');
    const audience = configService.get<string>('jwt.audience');

    // Fail fast at startup: a JWT strategy without an expected issuer and
    // audience would accept otherwise valid tokens minted for another service.
    if (!issuer || !audience) {
      throw new InternalServerErrorException(
        'JWT issuer and audience must be configured',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('jwt.secret') ||
        'fallback_secret_do_not_use_in_prod',
      issuer,
      audience,
    });

    this.expectedIssuer = issuer;
    this.expectedAudience = audience;
  }

  async validate(payload: JwtPayload) {
    if (!payload.sub) throw new UnauthorizedException();

    // Reject tokens with missing or mismatched issuer/audience claims so that
    // tokens minted for another service cannot be replayed here.
    if (payload.iss !== this.expectedIssuer) {
      throw new UnauthorizedException('Invalid token issuer');
    }
    if (payload.aud !== this.expectedAudience) {
      throw new UnauthorizedException('Invalid token audience');
    }

    // Reject if the session has been revoked (logout / logout-all)
    if (payload.sid) {
      const session = await this.sessionManager.getSession(payload.sid);
      if (!session) throw new UnauthorizedException('Session has been revoked');
    }

    // Reject access tokens that were minted from a refresh token which has
    // since been rotated or revoked. This closes the window where a stolen
    // access token could outlive the refresh token it was derived from.
    if (payload.rtid) {
      const refreshToken = await this.sessionManager.getRefreshToken(
        payload.rtid,
      );
      if (!refreshToken || refreshToken.revoked || refreshToken.rotated) {
        throw new UnauthorizedException('Refresh token has been revoked');
      }
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User is inactive or not found');
    }

    return {
      id: user.id,
      userId: user.id,
      username: user.username,
      walletAddress: user.walletAddress,
      sessionId: payload.sid,
      refreshTokenId: payload.rtid,
    };
  }
}
