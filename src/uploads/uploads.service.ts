import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs, createReadStream } from 'fs';
import { join, resolve, sep } from 'path';
import { randomUUID, createHash } from 'crypto';
import { MalwareScannerService } from './malware-scanner.service';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
  path?: string;
}

export interface StoreOptions {
  tenantId: string;
  operation: string;
  /**
   * Optional client-provided checksum of the uploaded content.
   * Format: `<algorithm>:<hex digest>` where algorithm is one of
   * `sha256` (default) or `sha512`. When omitted, the server still
   * computes a digest but does not reject the upload.
   */
  checksum?: string;
}

export interface StoredFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  scanStatus: 'clean';
  scannedAt: Date;
  checksum: string;
}

const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

const SUPPORTED_CHECKSUM_ALGORITHMS = new Set<string>(['sha256', 'sha512']);
const DEFAULT_CHECKSUM_ALGORITHM = 'sha256';

const ALLOWED_MIME_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'text/csv',
]);

const ALLOWED_EXTENSIONS = new Set<string>([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.txt',
  '.csv',
]);

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,128}$/;

interface SignatureRule {
  mimeTypes: string[];
  matches: (buffer: Buffer) => boolean;
}

const SIGNATURE_RULES: SignatureRule[] = [
  {
    mimeTypes: ['image/jpeg'],
    matches: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimeTypes: ['image/png'],
    matches: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  {
    mimeTypes: ['image/gif'],
    matches: (b) => b.length >= 6 && b.slice(0, 6).toString('ascii').match(/^GIF8[79]a$/) !== null,
  },
  {
    mimeTypes: ['image/webp'],
    matches: (b) =>
      b.length >= 12 &&
      b.slice(0, 4).toString('ascii') === 'RIFF' &&
      b.slice(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mimeTypes: ['application/pdf'],
    matches: (b) => b.length >= 5 && b.slice(0, 5).toString('ascii') === '%PDF-',
  },
];

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);
  private readonly uploadDir: string;
  private readonly maxSizeBytes: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly malwareScanner: MalwareScannerService,
  ) {
    this.uploadDir = this.configService.get<string>('UPLOAD_DIR', join(process.cwd(), 'uploads'));
    this.maxSizeBytes = this.configService.get<number>('UPLOAD_MAX_SIZE_BYTES', DEFAULT_MAX_SIZE_BYTES);
  }

  async store(file: UploadedFile, options: StoreOptions): Promise<StoredFile> {
    this.validateSize(file);
    this.validateType(file);

    const buffer = await this.readBuffer(file);
    this.validateSignature(file, buffer);

    const scanResult = await this.malwareScanner.scan(buffer);
    if (!scanResult || scanResult.status !== 'clean') {
      throw new BadRequestException('Uploaded file failed malware scanning');
    }

    const { algorithm, expected } = this.parseChecksum(options.checksum);
    const computed = await this.computeDigest(file, algorithm);
    if (expected && computed !== expected) {
      if (file.path) {
        await this.cleanup(file.path);
      }
      throw new BadRequestException('Uploaded file checksum does not match the provided value');
    }

    const id = randomUUID();
    const extension = this.extensionOf(file.originalname);
    const destination = this.buildStoragePath(options, id, extension);

    try {
      await fs.mkdir(join(this.uploadDir, this.safeSegment(options.tenantId), this.safeSegment(options.operation)), {
        recursive: true,
      });
      await fs.writeFile(destination, buffer);
    } catch (error) {
      await this.cleanup(destination);
      throw error;
    }

    if (file.path) {
      await this.cleanup(file.path);
    }

    return {
      id,
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: buffer.length,
      path: destination,
      scanStatus: 'clean',
      scannedAt: new Date(),
      checksum: `${algorithm}:${computed}`,
    };
  }

  private parseChecksum(checksum?: string): { algorithm: string; expected?: string } {
    if (checksum === undefined || checksum === null || checksum === '') {
      return { algorithm: DEFAULT_CHECKSUM_ALGORITHM };
    }
    if (typeof checksum !== 'string') {
      throw new BadRequestException('Checksum must be a string');
    }
    const separator = checksum.indexOf(':');
    const algorithm = separator >= 0 ? checksum.slice(0, separator).toLowerCase() : DEFAULT_CHECKSUM_ALGORITHM;
    const digest = (separator >= 0 ? checksum.slice(separator + 1) : checksum).toLowerCase();
    if (!SUPPORTED_CHECKSUM_ALGORITHMS.has(algorithm)) {
      throw new BadRequestException(
        `Unsupported checksum algorithm; supported: ${Array.from(SUPPORTED_CHECKSUM_ALGORITHMS).join(', ')}`,
      );
    }
    if (!/^[0-9a-f]+$/.test(digest)) {
      throw new BadRequestException('Checksum digest must be a hexadecimal string');
    }
    return { algorithm, expected: digest };
  }

  private async computeDigest(file: UploadedFile, algorithm: string): Promise<string> {
    const hash = createHash(algorithm);
    if (file.buffer) {
      hash.update(file.buffer);
      return hash.digest('hex');
    }
    if (file.path) {
      await new Promise<void>((resolvePromise, rejectPromise) => {
        const stream = createReadStream(file.path as string);
        stream.on('data', (chunk) => hash.update(chunk));
        stream.on('error', rejectPromise);
        stream.on('end', () => resolvePromise());
      });
      return hash.digest('hex');
    }
    throw new BadRequestException('Uploaded file has no content');
  }

  private buildStoragePath(options: StoreOptions, id: string, extension: string): string {
    const tenantSegment = this.safeSegment(options.tenantId);
    const operationSegment = this.safeSegment(options.operation);
    const fileName = `${id}${extension}`;
    const destination = resolve(this.uploadDir, tenantSegment, operationSegment, fileName);
    const root = resolve(this.uploadDir);
    if (destination !== root && !destination.startsWith(root + sep)) {
      throw new BadRequestException('Resolved upload path escapes the upload directory');
    }
    return destination;
  }

  private safeSegment(value: string): string {
    if (typeof value !== 'string' || !SAFE_SEGMENT.test(value)) {
      throw new BadRequestException('Invalid upload scope identifier');
    }
    return value;
  }

  private validateSize(file: UploadedFile): void {
    if (typeof file.size !== 'number' || file.size <= 0) {
      throw new BadRequestException('Uploaded file is empty');
    }
    if (file.size > this.maxSizeBytes) {
      throw new BadRequestException(
        `Uploaded file exceeds the maximum allowed size of ${this.maxSizeBytes} bytes`,
      );
    }
  }

  private validateType(file: UploadedFile): void {
    const extension = this.extensionOf(file.originalname);
    if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(extension)) {
      throw new BadRequestException('Uploaded file type is not allowed');
    }
  }

  private validateSignature(file: UploadedFile, buffer: Buffer): void {
    const rule = SIGNATURE_RULES.find((r) => r.mimeTypes.includes(file.mimetype));
    if (rule && !rule.matches(buffer)) {
      throw new BadRequestException('Uploaded file content does not match its declared type');
    }
  }

  private async readBuffer(file: UploadedFile): Promise<Buffer> {
    if (file.buffer) {
      return file.buffer;
    }
    if (file.path) {
      return fs.readFile(file.path);
    }
    throw new BadRequestException('Uploaded file has no content');
  }

  private extensionOf(name: string): string {
    const index = name.lastIndexOf('.');
    return index >= 0 ? name.slice(index).toLowerCase() : '';
  }

  private async cleanup(path: string): Promise<void> {
    try {
      await fs.unlink(path);
    } catch (error) {
      this.logger.warn(`Failed to clean up temporary file at ${path}: ${(error as Error).message}`);
    }
  }
}
