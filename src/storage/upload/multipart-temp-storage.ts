import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Directory Multer's disk storage engine writes incoming multipart parts to
 * before they're validated and copied into permanent storage.
 *
 * Kept outside the permanent `uploadDir` (see `FileUploadService`) so a
 * crash or restart can safely sweep this directory without touching
 * completed uploads. Configurable via `MULTIPART_TEMP_DIR` for deployments
 * that need temp storage on a specific volume.
 */
export function resolveMultipartTempDir(): string {
  const dir = process.env.MULTIPART_TEMP_DIR ?? path.join(os.tmpdir(), 'stellarswipe-multipart');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  return dir;
}

/**
 * Multer storage engine for multipart endpoints that must guarantee cleanup
 * of partial/abandoned uploads (see `MultipartCleanupInterceptor`). Streams
 * each uploaded part straight to a randomly named file under the multipart
 * temp dir instead of buffering the whole request in memory, so a dropped
 * connection mid-upload leaves at most one discrete temp file to remove
 * rather than an unbounded amount of retained memory.
 */
export const multipartDiskStorage = diskStorage({
  destination: (_req, _file, callback) => {
    try {
      callback(null, resolveMultipartTempDir());
    } catch (error) {
      callback(error as Error, '');
    }
  },
  filename: (_req, _file, callback) => {
    callback(null, `${randomUUID()}.part`);
  },
});
