import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { promises as fs } from 'fs';
import { Observable, catchError, finalize, tap, throwError } from 'rxjs';

/** Narrow shape of the fields Multer's disk storage engine populates on a file. */
interface MulterDiskFile {
  path?: string;
}

/**
 * Guarantees that temporary files written to disk by Multer's disk storage
 * engine (see `multipartDiskStorage`) for a multipart/form-data request are
 * removed once the request is done with them — whether the upload completed
 * normally and was copied into permanent storage, failed validation, or the
 * client disconnected mid-upload.
 *
 * Must be listed *after* `FileInterceptor`/`FilesInterceptor` in
 * `@UseInterceptors(...)` so `request.file` / `request.files` are already
 * populated by the time this interceptor's `intercept()` runs (NestJS
 * interceptors nest in the order they're listed — the first one listed is
 * outermost and runs its "before" phase first).
 */
@Injectable()
export class MultipartCleanupInterceptor implements NestInterceptor {
  private readonly logger = new Logger(MultipartCleanupInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const tempPaths = this.collectTempPaths(request);
    if (tempPaths.length === 0) {
      return next.handle();
    }

    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      for (const tempPath of tempPaths) {
        void this.removeQuietly(tempPath);
      }
    };

    // Belt-and-braces for a client that disconnects mid-upload or before
    // the response finishes sending: these socket-level events fire
    // regardless of whether the RxJS pipeline below ever settles.
    request.once('aborted', cleanup);
    response.once('close', () => {
      if (!response.writableFinished) {
        cleanup();
      }
    });

    return next.handle().pipe(
      tap(() => cleanup()),
      catchError((error) => {
        cleanup();
        return throwError(() => error);
      }),
      finalize(() => cleanup()),
    );
  }

  private collectTempPaths(request: Request): string[] {
    const paths: string[] = [];

    const single = (request as unknown as { file?: MulterDiskFile }).file;
    if (single?.path) {
      paths.push(single.path);
    }

    const many = (request as unknown as { files?: MulterDiskFile[] | Record<string, MulterDiskFile[]> })
      .files;
    if (Array.isArray(many)) {
      for (const file of many) {
        if (file?.path) paths.push(file.path);
      }
    } else if (many && typeof many === 'object') {
      for (const group of Object.values(many)) {
        for (const file of group) {
          if (file?.path) paths.push(file.path);
        }
      }
    }

    return paths;
  }

  private async removeQuietly(tempPath: string): Promise<void> {
    try {
      await fs.unlink(tempPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code !== 'ENOENT') {
        this.logger.warn(`Failed to clean up temporary upload file at ${tempPath}: ${err.message}`);
      }
    }
  }
}
