import {
  Injectable,
  Logger,
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  Optional,
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
import {
  ArchiveImportGuardService,
  ArchiveLimits,
  ArchiveExtractionResult,
} from './security/archive-import-guard.service';

/**
 * FileUploadService
 *
 * Provides secure file upload handling with:
 * - Strict content-type and MIME validation
 * - File size limit enforcement
 * - File name sanitization (path traversal prevention)
 * - Secure temp storage with random file names
 * - Content hash computation for deduplication
 * - Bounded archive import inspection (decompression bomb protection)
 */
@Injectable()
export class FileUploadService {
  private readonly logger = new Logger(FileUploadService.name);
  private readonly uploadDir: string;
  private readonly archiveGuard: ArchiveImportGuardService;

  constructor(
    private readonly configService: ConfigService,
    @Optional() archiveGuard?: ArchiveImportGuardService,
  ) {
    this.uploadDir =
      this.configService.get<string>('UPLOAD_DIR') ??
      path.resolve('/tmp', 'stellarswipe-uploads');
    this.archiveGuard = archiveGuard ?? new ArchiveImportGuardService();

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

  /**
   * Safely extracts and imports an archive (ZIP or GZIP) while enforcing
   * bounds on compressed size, expanded size, entry count, expansion ratio,
   * and nesting depth before any entry is processed or persisted.
   * Rejected archives and temporary files are cleaned up automatically.
   */
  async importArchive(
    archive: {
      buffer?: Buffer;
      tempFilePath?: string;
      originalname: string;
      mimetype?: string;
    },
    limits?: ArchiveLimits,
    fileOptions?: FileUploadOptions,
  ): Promise<{
    extraction: ArchiveExtractionResult;
    storedFiles: FileUploadResponseDto[];
  }> {
    const extraction = await this.archiveGuard.inspectAndExtract(
      {
        buffer: archive.buffer,
        tempFilePath: archive.tempFilePath,
        originalName: archive.originalname,
      },
      limits,
    );

    const storedFiles: FileUploadResponseDto[] = [];
    try {
      for (const entry of extraction.entries) {
        const ext = path.extname(entry.name).toLowerCase();
        const inferredMime = this.inferMimeTypeFromExtension(ext);
        const stored = await this.storeFile(
          {
            buffer: entry.data,
            originalname: path.basename(entry.name),
            mimetype: inferredMime,
            size: entry.uncompressedSize,
          },
          fileOptions,
        );
        storedFiles.push(stored);
      }

      if (archive.tempFilePath && fs.existsSync(archive.tempFilePath)) {
        try {
          await fs.promises.unlink(archive.tempFilePath);
        } catch {
          // ignore cleanup failure on already removed temp file
        }
      }

      return { extraction, storedFiles };
    } catch (error) {
      // Roll back any already persisted files if a later entry fails validation
      for (const stored of storedFiles) {
        this.deleteFile(stored.storagePath);
      }
      if (archive.tempFilePath && fs.existsSync(archive.tempFilePath)) {
        try {
          await fs.promises.unlink(archive.tempFilePath);
        } catch {
          // ignore cleanup error
        }
      }
      throw error;
    }
  }

  private inferMimeTypeFromExtension(ext: string): string {
    switch (ext) {
      case '.csv':
        return 'text/csv';
      case '.json':
        return 'application/json';
      case '.txt':
        return 'text/plain';
      case '.pdf':
        return 'application/pdf';
      case '.png':
        return 'image/png';
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.gif':
        return 'image/gif';
      case '.webp':
        return 'image/webp';
      default:
        return 'application/octet-stream';
    }
  }

  getUploadDir(): string {
    return this.uploadDir;
  }
}


