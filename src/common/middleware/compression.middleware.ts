import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import * as compression from 'compression';
import { compressionConfig } from '../config/compression.config';

@Injectable()
export class CompressionMiddleware implements NestMiddleware {
    private compressionMiddleware = compression(compressionConfig);

    use(req: Request, res: Response, next: NextFunction) {
        this.compressionMiddleware(req, res, next);
    }
}
