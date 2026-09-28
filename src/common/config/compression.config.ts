import { CompressionOptions } from 'compression';
import { Request, Response } from 'express';

/**
 * Response-body content types eligible for transparent compression.
 *
 * Includes `application/graphql-response+json` (the Apollo Server 4 /
 * graphql-over-http spec content type) alongside the legacy
 * `application/json` responses that older Apollo Server / apollo-server-express
 * setups emit, so large GraphQL query/report responses are compressed the
 * same way plain REST JSON responses already are.
 */
const COMPRESSIBLE_CONTENT_TYPE_PATTERN =
    /json|text|javascript|css|xml|graphql-response/;

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
            // Compress JSON, text, GraphQL, and common web formats.
            return COMPRESSIBLE_CONTENT_TYPE_PATTERN.test(contentType);
        }

        return false;
    },
};
