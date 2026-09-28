import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { FailoverRoutingService } from '../failover-routing.service';

@Injectable()
export class RegionFailoverMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RegionFailoverMiddleware.name);

  constructor(private readonly failoverRoutingService: FailoverRoutingService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (this.failoverRoutingService.shouldFailover()) {
      const newEndpoint = this.failoverRoutingService.triggerFailover(
        'Primary region unhealthy',
        req.path,
      );

      if (newEndpoint) {
        req.headers['x-routed-region'] = this.failoverRoutingService.getActiveRegion();
        req.headers['x-failover-active'] = 'true';
        this.logger.warn(
          `Request ${req.method} ${req.path} rerouted to failover region: ${newEndpoint}`,
        );
      }
    } else {
      req.headers['x-active-region'] = this.failoverRoutingService.getActiveRegion();
    }

    next();
  }
}
