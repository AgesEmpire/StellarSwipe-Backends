/**
 * Guard used for backend health and metrics endpoints.
 * Only authenticated internal or authorized clients may access these routes.
 * Supports JWT bearer auth and admin-style API keys.
 */
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeyAuthGuard } from '../../api-keys/guards/api-key-auth.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@Injectable()
export class HealthMetricsAuthGuard implements CanActivate {
  constructor(
    private readonly jwtAuthGuard: JwtAuthGuard,
    private readonly apiKeyAuthGuard: ApiKeyAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    let jwtError: unknown;

    try {
      if (await this.jwtAuthGuard.canActivate(context)) {
        return true;
      }
    } catch (error) {
      jwtError = error;
    }

    try {
      if (await this.apiKeyAuthGuard.canActivate(context)) {
        return true;
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      if (jwtError instanceof ForbiddenException) {
        throw jwtError;
      }
      throw error;
    }

    if (jwtError) {
      if (jwtError instanceof Error) {
        throw jwtError;
      }
    }

    throw new UnauthorizedException(
      'Authentication is required for health and metrics endpoints',
    );
  }
}
