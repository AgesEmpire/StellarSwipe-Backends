import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { SignalThrottleService } from './signal-throttle.service';
import { Reflector } from '@nestjs/core';

@Injectable()
export class SignalThrottleGuard implements CanActivate {
  constructor(
    private readonly throttleService: SignalThrottleService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    let providerId: string;
    
    if (context.getType() === 'ws') {
      const client = context.switchToWs().getClient();
      providerId = client.user?.id || client.handshake?.user?.id || client.providerId;
    } else {
      const request = context.switchToHttp().getRequest();
      providerId = request.user?.id || request.body?.providerId;
    }

    if (!providerId) {
      return true;
    }

    const config = { limit: 5, ttlSeconds: 60 };

    const allowed = await this.throttleService.checkThrottle(providerId, config);

    if (!allowed) {
      if (context.getType() === 'ws') {
        throw new Error('Rate limit exceeded: Too many signals');
      } else {
        throw new HttpException('Too Many Requests: Signal creation rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    return true;
  }
}
