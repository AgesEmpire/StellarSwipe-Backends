import { CompressionOptions } from 'compression';
import { Request, Response } from 'express';

export const compressionConfig: CompressionOptions = {
    threshold: 1024, // only compress responses that are larger than 1KB
    level: 6, // default compression level
    filter: (req: Request, res: Response) => {
        if (req.headers['x-no-compression']) {
            // don't compress responses with this request header
            return false;
        }

        // fallback to standard filter function
        const contentType = res.getHeader('Content-Type') as string;
        if (contentType) {
            // Compress JSON, text, and common web formats
            return /json|text|javascript|css|xml/.test(contentType);
        }

        return false;
    },
};
