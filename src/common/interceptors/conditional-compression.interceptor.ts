/**
 * ConditionalCompressionInterceptor
 *
 * Compresses outgoing response bodies when:
 *   1. The client advertises gzip or brotli support via Accept-Encoding.
 *   2. The serialised body exceeds a configurable minimum size threshold.
 *
 * Compression is skipped for:
 *   - Responses below the size threshold (avoids wasting CPU on tiny payloads).
 *   - Content types that are already compressed or binary (images, PDF, zip,
 *     video, audio, octet-stream, CSV export treated as text/csv, etc.).
 *   - Responses that already carry a Content-Encoding header (no double compression).
 *
 * When compression is applied the interceptor sets Content-Encoding and
 * Content-Length (compressed size) on the response.
 *
 * Brotli is preferred over gzip when the client supports both, as it
 * typically yields better compression ratios for JSON.
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { brotliCompressSync, gzipSync } from 'zlib';
import { Response, Request } from 'express';

/** Minimum serialised body size (bytes) before compression is attempted. */
const DEFAULT_MIN_SIZE_BYTES = 1024; // 1 KB

/**
 * Content-Type patterns whose responses must NOT be double-compressed.
 * These either are already compressed formats or binary streams where
 * gzip/br headers would be misleading.
 */
const SKIP_COMPRESSION_PATTERN =
  /image\/|video\/|audio\/|application\/zip|application\/gzip|application\/x-brotli|application\/pdf|application\/octet-stream|font\//i;

/** Content types we actively want to compress. */
const COMPRESSIBLE_PATTERN =
  /json|text\/|javascript|css|xml|application\/graphql/i;

export interface ConditionalCompressionOptions {
  /** Minimum body size in bytes before compression is applied. Defaults to 1 KB. */
  minSizeBytes?: number;
}

@Injectable()
export class ConditionalCompressionInterceptor implements NestInterceptor {
  private readonly minSizeBytes: number;

  constructor(options: ConditionalCompressionOptions = {}) {
    this.minSizeBytes = options.minSizeBytes ?? DEFAULT_MIN_SIZE_BYTES;
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();

    return next.handle().pipe(
      map((body) => {
        // Skip if a Content-Encoding is already set (streamed or pre-compressed).
        if (res.getHeader('content-encoding')) {
          return body;
        }

        const acceptEncoding = String(
          req.headers['accept-encoding'] ?? '',
        ).toLowerCase();
        const supportsBr = acceptEncoding.includes('br');
        const supportsGzip = acceptEncoding.includes('gzip');

        if (!supportsBr && !supportsGzip) {
          return body;
        }

        const contentType = String(
          res.getHeader('content-type') ?? 'application/json',
        ).toLowerCase();

        // Skip already-compressed or binary content types.
        if (SKIP_COMPRESSION_PATTERN.test(contentType)) {
          return body;
        }

        // Only compress recognised compressible types.
        if (!COMPRESSIBLE_PATTERN.test(contentType)) {
          return body;
        }

        const serialised =
          typeof body === 'string' ? body : JSON.stringify(body);
        const raw = Buffer.from(serialised, 'utf8');

        if (raw.byteLength < this.minSizeBytes) {
          return body;
        }

        let compressed: Buffer;
        let encoding: string;

        if (supportsBr) {
          compressed = brotliCompressSync(raw);
          encoding = 'br';
        } else {
          compressed = gzipSync(raw);
          encoding = 'gzip';
        }

        res.setHeader('Content-Encoding', encoding);
        res.setHeader('Content-Length', compressed.byteLength);

        // Send the compressed buffer directly and signal NestJS not to re-serialise.
        res.end(compressed);

        // Return undefined so the framework does not attempt a second write.
        return undefined;
      }),
    );
  }
}
