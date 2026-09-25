import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { MalwareScannerService } from './malware-scanner.service';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer?: Buffer;
  path?: string;
}

export interface StoredFile {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  path: string;
  scanStatus: 'clean';
  scannedAt: Date;
}

const DEFAULT_MAX_SIZE_BYTES = 10 * 1024 * 1024;

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

  async store(file: UploadedFile): Promise<StoredFile> {
    this.validateSize(file);
    this.validateType(file);

    const buffer = await this.readBuffer(file);
    this.validateSignature(file, buffer);

    const scanResult = await this.malwareScanner.scan(buffer);
    if (!scanResult || scanResult.status !== 'clean') {
      throw new BadRequestException('Uploaded file failed malware scanning');
    }

    await fs.mkdir(this.uploadDir, { recursive: true });
    const id = randomUUID();
    const extension = this.extensionOf(file.originalname);
    const destination = join(this.uploadDir, `${id}${extension}`);

    try {
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
    };
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
