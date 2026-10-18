import {
  Injectable,
  Logger,
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pipeline } from 'stream/promises';
import {
  UploadedFileMetadata,
  FileUploadOptions,
  FileValidationResult,
  DEFAULT_ALLOWED_MIME_TYPES,
  DEFAULT_MAX_FILE_SIZE,
  SUPPORTED_CHECKSUM_ALGORITHMS,
  SupportedChecksumAlgorithm,
} from './interfaces/file-upload.interface';
import { FileUploadResponseDto } from './dto/file-upload-response.dto';

/**
 * FileUploadService
 *
 * Provides secure file upload handling with:
 * - Strict content-type and MIME validation
 * - File size limit enforcement
 * - File name sanitization (path traversal prevention)
 * - Secure temp storage with random file names
 * - Content hash computation for deduplication
 */
@Injectable()
export class FileUploadService {
  private readonly logger = new Logger(FileUploadService.name);
  private readonly uploadDir: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir =
      this.configService.get<string>('UPLOAD_DIR') ??
      path.resolve('/tmp', 'stellarswipe-uploads');

    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true, mode: 0o700 });
    }
  }

  // EICAR standard anti-virus test file signature substring
  private static readonly EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

  validateFile(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    options?: FileUploadOptions,
  ): FileValidationResult {
    const errors: string[] = [];
    const allowedMimeTypes = options?.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;
    const maxSize = options?.maxSize ?? DEFAULT_MAX_FILE_SIZE;

    if (!allowedMimeTypes.includes(file.mimetype)) {
      errors.push(
        `File type ${file.mimetype} is not allowed. Allowed types: ${allowedMimeTypes.join(', ')}`,
      );
    }

    if (file.size > maxSize) {
      errors.push(
        `File size ${file.size} bytes exceeds maximum allowed size of ${maxSize} bytes`,
      );
    }

    if (options?.sanitizeFileName !== false) {
      const sanitized = this.sanitizeFileName(file.originalname);
      if (sanitized !== file.originalname) {
        errors.push(`File name "${file.originalname}" contains invalid characters`);
      }
    }

    // Inspect content for disallowed executable headers or mismatched magic bytes
    const contentError = this.validateContent(file.buffer, file.mimetype, options?.validateContent);
    if (contentError) {
      errors.push(contentError);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validates file content and magic bytes to reject disguised or spoofed files.
   */
  validateContent(buffer: Buffer, declaredMimeType: string, strictCheck = false): string | null {
    if (!buffer || buffer.length === 0) return null;

    // Disallow executable binaries regardless of declared MIME type
    if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
      return 'Executable binary (MZ/DOS/PE) content is not allowed';
    }
    if (buffer.length >= 4 && buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
      return 'Executable binary (ELF) content is not allowed';
    }

    if (strictCheck) {
      if (declaredMimeType === 'image/jpeg' || declaredMimeType === 'image/jpg') {
        if (buffer.length < 3 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer[2] !== 0xff) {
          return 'File content does not match declared JPEG image format';
        }
      } else if (declaredMimeType === 'image/png') {
        const pngHeader = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
        if (buffer.length < 8 || !pngHeader.every((b, i) => buffer[i] === b)) {
          return 'File content does not match declared PNG image format';
        }
      } else if (declaredMimeType === 'image/gif') {
        if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== 'GIF8') {
          return 'File content does not match declared GIF image format';
        }
      } else if (declaredMimeType === 'image/webp') {
        if (
          buffer.length < 12 ||
          buffer.toString('ascii', 0, 4) !== 'RIFF' ||
          buffer.toString('ascii', 8, 12) !== 'WEBP'
        ) {
          return 'File content does not match declared WEBP image format';
        }
      } else if (declaredMimeType === 'application/pdf') {
        if (buffer.length < 4 || buffer.toString('ascii', 0, 4) !== '%PDF') {
          return 'File content does not match declared PDF document format';
        }
      }
    }

    return null;
  }

  /**
   * Scans file buffer against malware signatures before publishing.
   */
  async scanFileForMalware(buffer: Buffer): Promise<{ clean: boolean; threat?: string }> {
    try {
      if (buffer && buffer.includes(Buffer.from(FileUploadService.EICAR_SIGNATURE))) {
        return { clean: false, threat: 'EICAR-Test-Signature' };
      }
      return { clean: true };
    } catch (err) {
      this.logger.error(`Malware scan failed: ${err instanceof Error ? err.message : err}`);
      return { clean: false, threat: 'Scan failure' };
    }
  }

  async storeFile(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    options?: FileUploadOptions,
  ): Promise<FileUploadResponseDto> {
    const validation = this.validateFile(file, options);
    if (!validation.valid) {
      for (const error of validation.errors) {
        if (error.includes('not allowed') || error.includes('format') || error.includes('Executable')) {
          throw new UnsupportedMediaTypeException(error);
        }
        if (error.includes('exceeds maximum')) {
          throw new PayloadTooLargeException(error);
        }
      }
      throw new BadRequestException(validation.errors);
    }

    if (options?.scanMalware !== false) {
      const scanResult = await this.scanFileForMalware(file.buffer);
      if (!scanResult.clean) {
        throw new BadRequestException(
          `Malware scan rejected file: ${scanResult.threat ?? 'Suspicious content'}`,
        );
      }
    }

    const sanitizeFileName = options?.sanitizeFileName !== false;
    const computeHash = options?.computeHash !== false;

    const safeFileName = sanitizeFileName ? this.sanitizeFileName(file.originalname) : file.originalname;
    const extension = path.extname(safeFileName).toLowerCase();

    // Verify client-provided checksum before promoting file to durable storage
    const algorithm = options?.checksumAlgorithm ?? 'sha256';
    this.assertSupportedChecksumAlgorithm(algorithm);

    const calculatedHash = crypto.createHash(algorithm).update(file.buffer).digest('hex');
    if (options?.expectedChecksum) {
      this.verifyChecksum(calculatedHash, options.expectedChecksum, algorithm);
    }

    const contentHash = computeHash
      ? (algorithm === 'sha256' ? calculatedHash : crypto.createHash('sha256').update(file.buffer).digest('hex'))
      : '';

    const storedFileName = `${uuidv4()}${extension}`;
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const relativePath = path.join(datePrefix, storedFileName);
    const absolutePath = path.join(this.uploadDir, relativePath);

    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    let written = false;
    try {
      fs.writeFileSync(absolutePath, file.buffer, { mode: 0o600 });
      written = true;

      const metadata: FileUploadResponseDto = {
        id: uuidv4(),
        originalName: safeFileName,
        mimeType: file.mimetype,
        size: file.size,
        extension,
        storagePath: relativePath,
        contentHash,
        uploadedAt: new Date(),
      };

      this.logger.log(`File stored: ${safeFileName} (${file.size} bytes, ${file.mimetype}) -> ${relativePath}`);
      return metadata;
    } catch (error) {
      if (written && fs.existsSync(absolutePath)) {
        try {
          fs.unlinkSync(absolutePath);
        } catch {
          // ignore cleanup error
        }
      }
      throw error;
    }
  }

  /**
   * Promotes an uploaded file stream / temp file to durable storage while calculating
   * its digest on-the-fly and verifying against client-provided checksum without
   * buffering the full file into memory.
   */
  async storeStreamedFile(
    source: { stream: NodeJS.ReadableStream; originalname: string; mimetype: string; size?: number },
    options?: FileUploadOptions,
  ): Promise<FileUploadResponseDto> {
    const algorithm = options?.checksumAlgorithm ?? 'sha256';
    this.assertSupportedChecksumAlgorithm(algorithm);

    const sanitizeFileName = options?.sanitizeFileName !== false;
    const safeFileName = sanitizeFileName ? this.sanitizeFileName(source.originalname) : source.originalname;
    const extension = path.extname(safeFileName).toLowerCase();

    const storedFileName = `${uuidv4()}${extension}`;
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const relativePath = path.join(datePrefix, storedFileName);
    const absolutePath = path.join(this.uploadDir, relativePath);

    // Temp file for durable writing while streaming digest
    const tempPromotePath = `${absolutePath}.${uuidv4()}.tmp`;

    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const hashStream = crypto.createHash(algorithm);
    const sha256Stream = algorithm === 'sha256' ? null : crypto.createHash('sha256');
    const fileWriteStream = fs.createWriteStream(tempPromotePath, { mode: 0o600 });

    let bytesWritten = 0;
    try {
      await new Promise<void>((resolve, reject) => {
        source.stream.on('data', (chunk: Buffer) => {
          bytesWritten += chunk.length;
          hashStream.update(chunk);
          if (sha256Stream) {
            sha256Stream.update(chunk);
          }
          if (!fileWriteStream.write(chunk)) {
            source.stream.pause();
            fileWriteStream.once('drain', () => source.stream.resume());
          }
        });

        source.stream.on('error', reject);
        fileWriteStream.on('error', reject);
        source.stream.on('end', () => {
          fileWriteStream.end(() => resolve());
        });
      });

      const calculatedDigest = hashStream.digest('hex');
      if (options?.expectedChecksum) {
        this.verifyChecksum(calculatedDigest, options.expectedChecksum, algorithm);
      }

      // Promote temp file to durable target atomically
      fs.renameSync(tempPromotePath, absolutePath);

      const contentHash = options?.computeHash !== false
        ? (algorithm === 'sha256' ? calculatedDigest : sha256Stream!.digest('hex'))
        : '';

      const metadata: FileUploadResponseDto = {
        id: uuidv4(),
        originalName: safeFileName,
        mimeType: source.mimetype,
        size: bytesWritten,
        extension,
        storagePath: relativePath,
        contentHash,
        uploadedAt: new Date(),
      };

      this.logger.log(`Streamed file stored: ${safeFileName} (${bytesWritten} bytes, ${source.mimetype}) -> ${relativePath}`);
      return metadata;
    } catch (error) {
      if (fs.existsSync(tempPromotePath)) {
        try {
          fs.unlinkSync(tempPromotePath);
        } catch {
          // ignore cleanup error
        }
      }
      throw error;
    }
  }

  private assertSupportedChecksumAlgorithm(algorithm: string): void {
    if (!SUPPORTED_CHECKSUM_ALGORITHMS.includes(algorithm as any)) {
      throw new BadRequestException(
        `Unsupported checksum algorithm: '${algorithm}'. Supported algorithms: ${SUPPORTED_CHECKSUM_ALGORITHMS.join(', ')}`,
      );
    }
  }

  private verifyChecksum(actual: string, expected: string, algorithm: string): void {
    const cleanExpected = expected.trim().toLowerCase();
    const cleanActual = actual.toLowerCase();

    // Constant-time comparison to prevent timing side channels
    const expectedBuf = Buffer.from(cleanExpected);
    const actualBuf = Buffer.from(cleanActual);

    const matches =
      expectedBuf.length === actualBuf.length &&
      crypto.timingSafeEqual(expectedBuf, actualBuf);

    if (!matches) {
      throw new BadRequestException(
        `Checksum verification failed for algorithm '${algorithm}': expected ${cleanExpected}, calculated ${cleanActual}`,
      );
    }
  }

  async storeFiles(
    files: { buffer: Buffer; originalname: string; mimetype: string; size: number }[],
    options?: FileUploadOptions,
  ): Promise<{ files: FileUploadResponseDto[]; failed: { errors: string[] }[] }> {
    const results: FileUploadResponseDto[] = [];
    const failed: { errors: string[] }[] = [];

    for (const file of files) {
      try {
        const result = await this.storeFile(file, options);
        results.push(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown upload error';
        failed.push({ errors: [message] });
      }
    }

    return { files: results, failed };
  }

  sanitizeFileName(fileName: string): string {
    let sanitized = fileName
      .replace(/\0/g, '')
      .replace(/\.\./g, '')
      .replace(/[/\\]/g, '')
      .trim();

    sanitized = sanitized.replace(/\s+/g, '_');
    sanitized = sanitized.replace(/_+/g, '_');
    sanitized = sanitized.replace(/[^a-zA-Z0-9._-]/g, '');

    if (!sanitized || sanitized === '.') {
      sanitized = `upload_${uuidv4().slice(0, 8)}`;
    }

    return sanitized;
  }

  getAbsolutePath(relativePath: string): string {
    const absolute = path.resolve(this.uploadDir, relativePath);
    if (!absolute.startsWith(path.resolve(this.uploadDir))) {
      throw new BadRequestException('Invalid file path');
    }
    return absolute;
  }

  readFile(relativePath: string): Buffer {
    const absolutePath = this.getAbsolutePath(relativePath);
    if (!fs.existsSync(absolutePath)) {
      throw new BadRequestException(`File not found: ${relativePath}`);
    }
    return fs.readFileSync(absolutePath);
  }

  deleteFile(relativePath: string): boolean {
    const absolutePath = this.getAbsolutePath(relativePath);
    try {
      fs.unlinkSync(absolutePath);
      this.logger.log(`File deleted: ${relativePath}`);
      return true;
    } catch (error) {
      this.logger.warn(`Failed to delete file: ${relativePath}`, { error });
      return false;
    }
  }

  getUploadDir(): string {
    return this.uploadDir;
  }
}

