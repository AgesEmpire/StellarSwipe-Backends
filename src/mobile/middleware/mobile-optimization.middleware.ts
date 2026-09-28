import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { adaptivePollingInterval } from '../utils/delta-calculator';

@Injectable()
export class MobileOptimizationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const platform = req.headers['x-platform'] as string;
    const batteryLevel = req.headers['x-battery-level']
      ? Number(req.headers['x-battery-level'])
      : undefined;
    const networkType = (req.headers['x-network-type'] as string) ?? 'wifi';

    if (platform === 'ios' || platform === 'android') {
      // Suggest polling interval to client via header
      const pollInterval = adaptivePollingInterval(30_000, batteryLevel, networkType);
      res.setHeader('X-Poll-Interval', String(pollInterval));
      res.setHeader('X-Mobile-Optimized', '1');
    }

    // Enable response compression hint
    res.setHeader('Vary', 'Accept-Encoding');
    next();
  }
}
