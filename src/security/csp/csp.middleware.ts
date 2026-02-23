import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { CspDirectives } from '../config/csp.config';

@Injectable()
export class CspMiddleware implements NestMiddleware {
  constructor(private readonly configService: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const enabled = this.configService.get<boolean>('csp.enabled', true);
    if (!enabled) {
      return next();
    }

    const nonce = crypto.randomBytes(16).toString('base64');
    (req as any).cspNonce = nonce;

    const directives = this.configService.get<CspDirectives>('csp.directives');
    const reportOnly = this.configService.get<boolean>(
      'csp.reportOnly',
      false,
    );
    const additionalHeaders = this.configService.get<Record<string, string>>(
      'csp.additionalHeaders',
      {},
    );

    const cspHeader = this.buildCspHeader(directives, nonce);
    const headerName = reportOnly
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy';

    res.setHeader(headerName, cspHeader);

    Object.entries(additionalHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    next();
  }

  private buildCspHeader(directives: CspDirectives, nonce: string): string {
    return Object.entries(directives)
      .map(([key, values]) => {
        const processedValues = values.map((value) =>
          value.replace('{random}', nonce),
        );
        return `${key} ${processedValues.join(' ')}`;
      })
      .join('; ');
  }
}
