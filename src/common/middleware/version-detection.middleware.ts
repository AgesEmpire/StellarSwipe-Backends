import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class VersionDetectionMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const urlVersion = req.path.match(/\/api\/v(\d+)\//)?.[1];
    const headerVersion = req.headers['api-version'] as string;
    
    req['apiVersion'] = urlVersion || headerVersion || '1';
    next();
  }
}
