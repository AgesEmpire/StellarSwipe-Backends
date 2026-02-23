import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const DEPRECATED_VERSIONS = ['1'];
const SUNSET_DATES = {
  '1': '2025-12-31',
};

@Injectable()
export class DeprecationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const version = req['apiVersion'] || '1';
    
    if (DEPRECATED_VERSIONS.includes(version)) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', SUNSET_DATES[version] || 'TBD');
      res.setHeader('Link', `</api/v2>; rel="successor-version"`);
    }
    
    next();
  }
}
