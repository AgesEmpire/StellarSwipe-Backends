import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TimezoneConverter } from '../utils/timezone-converter';

const DEFAULT_TIMEZONE = 'UTC';

@Injectable()
export class TimezoneResolverMiddleware implements NestMiddleware {
  constructor(private readonly converter: TimezoneConverter) {}

  use(req: Request & { userTimezone?: string }, res: Response, next: NextFunction): void {
    const timezone =
      (req.headers['x-timezone'] as string) ||
      (req.query['timezone'] as string) ||
      DEFAULT_TIMEZONE;

    req.userTimezone = this.converter.isValidTimezone(timezone) ? timezone : DEFAULT_TIMEZONE;
    res.setHeader('X-Server-Timezone', 'UTC');
    next();
  }
}
