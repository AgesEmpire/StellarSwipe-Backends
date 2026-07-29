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
import {
  UploadedFileMetadata,
  FileUploadOptions,
  FileValidationResult,
  DEFAULT_ALLOWED_MIME_TYPES,
  DEFAULT_MAX_FILE_SIZE,
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

    return { valid: errors.length === 0, errors };
  }

  async storeFile(
    file: { buffer: Buffer; originalname: string; mimetype: string; size: number },
    options?: FileUploadOptions,
  ): Promise<FileUploadResponseDto> {
    const validation = this.validateFile(file, options);
    if (!validation.valid) {
      for (const error of validation.errors) {
        if (error.includes('not allowed')) throw new UnsupportedMediaTypeException(error);
        if (error.includes('exceeds maximum')) throw new PayloadTooLargeException(error);
      }
      throw new BadRequestException(validation.errors);
    }

    const sanitizeFileName = options?.sanitizeFileName !== false;
    const computeHash = options?.computeHash !== false;

    const safeFileName = sanitizeFileName ? this.sanitizeFileName(file.originalname) : file.originalname;
    const extension = path.extname(safeFileName).toLowerCase();
    const contentHash = computeHash
      ? crypto.createHash('sha256').update(file.buffer).digest('hex')
      : '';

    const storedFileName = `${uuidv4()}${extension}`;
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const relativePath = path.join(datePrefix, storedFileName);
    const absolutePath = path.join(this.uploadDir, relativePath);

    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    fs.writeFileSync(absolutePath, file.buffer, { mode: 0o600 });

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

