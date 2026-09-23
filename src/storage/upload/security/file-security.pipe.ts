import {
  Injectable,
  Logger,
  PayloadTooLargeException,
  PipeTransform,
  UnprocessableEntityException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import * as path from 'path';
import {
  ALLOWED_UPLOAD_MIME_TYPES,
  DISALLOWED_EXTENSIONS,
  MAX_UPLOAD_SIZE_BYTES,
  SAFE_FILENAME_PATTERN,
} from './file-security.config';
import { MalwareScanService } from './malware-scan.service';

type MulterFile = Express.Multer.File;

/**
 * Drop-in ParseFilePipe replacement for upload endpoints:
 *   @UploadedFile(new FileSecurityPipe(malwareScanService)) file: Express.Multer.File
 *
 * Validates MIME type, size limit and filename shape, then runs the file
 * through the malware-scanning hook before the controller ever touches the
 * bytes for persistence. Rejects (throws) rather than persisting on any
 * failure — including scanner failures (fail closed).
 *
 * Emits structured log lines for every accept/reject decision so upload
 * security events are observable without additional wiring.
 */
@Injectable()
export class FileSecurityPipe implements PipeTransform<MulterFile, Promise<MulterFile>> {
  private readonly logger = new Logger('UploadSecurity');

  constructor(private readonly malwareScanService: MalwareScanService = new MalwareScanService()) {}

  async transform(file: MulterFile): Promise<MulterFile> {
    if (!file) {
      throw new UnprocessableEntityException('No file provided');
    }

    const meta = {
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
    };

    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      this.logger.warn(`Upload rejected: size limit exceeded ${JSON.stringify(meta)}`);
      throw new PayloadTooLargeException(
        `File exceeds maximum allowed size of ${MAX_UPLOAD_SIZE_BYTES} bytes`,
      );
    }

    if (!ALLOWED_UPLOAD_MIME_TYPES.includes(file.mimetype as any)) {
      this.logger.warn(`Upload rejected: disallowed MIME type ${JSON.stringify(meta)}`);
      throw new UnsupportedMediaTypeException(`MIME type "${file.mimetype}" is not permitted`);
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (DISALLOWED_EXTENSIONS.includes(ext)) {
      this.logger.warn(`Upload rejected: disallowed extension ${JSON.stringify(meta)}`);
      throw new UnsupportedMediaTypeException(`File extension "${ext}" is not permitted`);
    }

    if (!SAFE_FILENAME_PATTERN.test(file.originalname)) {
      this.logger.warn(`Upload rejected: unsafe filename ${JSON.stringify(meta)}`);
      throw new UnprocessableEntityException(
        'Filename must be alphanumeric with a single extension and no path separators',
      );
    }

    const scanResult = await this.malwareScanService.scan(file.buffer, file.originalname);
    if (!scanResult.clean) {
      this.logger.warn(
        `Upload rejected: malware scan failed ${JSON.stringify({ ...meta, reason: scanResult.reason })}`,
      );
      throw new UnprocessableEntityException('File failed content security scan');
    }

    this.logger.log(`Upload accepted ${JSON.stringify({ ...meta, scanner: scanResult.scannerName })}`);
    return file;
  }
}
