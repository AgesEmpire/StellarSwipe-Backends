import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ShutdownService } from './shutdown.service';

/**
 * Rejects new HTTP traffic once graceful shutdown has begun (#1058).
 *
 * Applied globally, ahead of routing, so requests arriving after SIGTERM —
 * whether because the load balancer hasn't deregistered this instance yet or
 * because a client already had the connection open — get a fast, explicit
 * 503 instead of being handled with resources that are mid-teardown.
 * Health/readiness endpoints are exempt so liveness/readiness probes keep
 * working during the drain window.
 */
@Injectable()
export class ShutdownGuardMiddleware implements NestMiddleware {
  constructor(private readonly shutdownService: ShutdownService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (!this.shutdownService.isShuttingDown() || req.path.includes('/health')) {
      next();
      return;
    }

    res.setHeader('Connection', 'close');
    res.setHeader('Retry-After', '5');
    res.status(503).json({
      type: 'urn:stellarswipe:problem:S5004',
      title: 'Service Unavailable',
      status: 503,
      detail: 'The server is shutting down and is not accepting new requests.',
      instance: req.originalUrl,
      timestamp: new Date().toISOString(),
      errorCode: 'S5004',
    });
  }
}
