import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, PayloadTooLargeException, UnsupportedMediaTypeException } from '@nestjs/common';
import { FileUploadService } from './file-upload.service';
import * as fs from 'fs';
import * as path from 'path';

describe('FileUploadService', () => {
  let service: FileUploadService;
  const testUploadDir = '/tmp/stellarswipe-test-uploads';

  beforeAll(() => {
    if (!fs.existsSync(testUploadDir)) {
      fs.mkdirSync(testUploadDir, { recursive: true });
    }
  });

  afterAll(() => {
    fs.rmSync(testUploadDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileUploadService,
        { provide: ConfigService, useValue: new ConfigService({ UPLOAD_DIR: testUploadDir }) },
      ],
    }).compile();
    service = module.get<FileUploadService>(FileUploadService);
  });

  describe('validateFile', () => {
    it('accepts a valid JPEG file', () => {
      const file = { buffer: Buffer.from('data'), originalname: 'photo.jpg', mimetype: 'image/jpeg', size: 1024 };
      expect(service.validateFile(file).valid).toBe(true);
    });

    it('rejects unsupported MIME type', () => {
      const file = { buffer: Buffer.from('data'), originalname: 'script.exe', mimetype: 'application/x-msdownload', size: 100 };
      const result = service.validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('application/x-msdownload');
    });

    it('rejects oversized files', () => {
      const file = { buffer: Buffer.alloc(6 * 1024 * 1024), originalname: 'large.pdf', mimetype: 'application/pdf', size: 6 * 1024 * 1024 };

  describe('storeFile', () => {
    it('stores a valid file and returns metadata', async () => {
      const file = { buffer: Buffer.from('hello'), originalname: 'hello.txt', mimetype: 'text/plain', size: 5 };
      const result = await service.storeFile(file);
      expect(result.originalName).toBe('hello.txt');
      expect(result.mimeType).toBe('text/plain');
      expect(result.size).toBe(5);
      expect(result.extension).toBe('.txt');
      expect(result.contentHash).toBeDefined();
      expect(fs.existsSync(path.join(testUploadDir, result.storagePath))).toBe(true);
    });

    it('throws for invalid MIME type', async () => {
      const file = { buffer: Buffer.from('bad'), originalname: 'evil.exe', mimetype: 'application/x-msdownload', size: 100 };
      await expect(service.storeFile(file)).rejects.toThrow(UnsupportedMediaTypeException);
    });

    it('throws for oversized file', async () => {
      const file = { buffer: Buffer.alloc(6 * 1024 * 1024), originalname: 'big.pdf', mimetype: 'application/pdf', size: 6 * 1024 * 1024 };
      await expect(service.storeFile(file)).rejects.toThrow(PayloadTooLargeException);
    });
  });

  describe('storeFiles', () => {
    it('stores multiple valid files', async () => {
      const files = [
        { buffer: Buffer.from('a'), originalname: 'a.txt', mimetype: 'text/plain', size: 1 },
        { buffer: Buffer.from('b'), originalname: 'b.txt', mimetype: 'text/plain', size: 1 },
      ];
      const result = await service.storeFiles(files);
      expect(result.files).toHaveLength(2);
      expect(result.failed).toHaveLength(0);
    });

    it('collects failures for invalid files', async () => {
      const files = [
        { buffer: Buffer.from('ok'), originalname: 'ok.txt', mimetype: 'text/plain', size: 2 },
        { buffer: Buffer.from('bad'), originalname: 'bad.exe', mimetype: 'application/x-msdownload', size: 100 },
      ];
      const result = await service.storeFiles(files);
      expect(result.files).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
    });
  });

  describe('sanitizeFileName', () => {
    it('removes null bytes', () => expect(service.sanitizeFileName('file\0.txt')).toBe('file.txt'));
    it('removes path traversal', () => expect(service.sanitizeFileName('../../../etc')).not.toContain('..'));
    it('replaces whitespace', () => expect(service.sanitizeFileName('my file.txt')).toBe('my_file.txt'));
    it('removes directory separators', () => expect(service.sanitizeFileName('dir/file.txt')).not.toContain('/'));
    it('generates fallback for empty', () => expect(service.sanitizeFileName('')).toMatch(/^upload_[a-f0-9]{8}$/));
  });

  describe('getAbsolutePath', () => {
    it('resolves valid paths', () => {
      expect(service.getAbsolutePath('sub/file.txt')).toBe(path.join(testUploadDir, 'sub/file.txt'));
    });
    it('throws for traversal', () => {
      expect(() => service.getAbsolutePath('../../etc')).toThrow(BadRequestException);
    });
  });

  describe('readFile / deleteFile', () => {
    it('reads stored file', async () => {
      const meta = await service.storeFile({ buffer: Buffer.from('content'), originalname: 'r.txt', mimetype: 'text/plain', size: 7 });
      expect(service.readFile(meta.storagePath).toString()).toBe('content');
    });
    it('deletes stored file', async () => {
      const meta = await service.storeFile({ buffer: Buffer.from('del'), originalname: 'd.txt', mimetype: 'text/plain', size: 3 });
      expect(service.deleteFile(meta.storagePath)).toBe(true);
      expect(fs.existsSync(path.join(testUploadDir, meta.storagePath))).toBe(false);
    });
  });

  describe('getUploadDir', () => {
    it('returns configured directory', () => expect(service.getUploadDir()).toBe(testUploadDir));
  });
});

      const result = service.validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('exceeds maximum');
    });

    it('rejects path traversal in file name', () => {
      const file = { buffer: Buffer.from('data'), originalname: '../../etc/passwd', mimetype: 'text/plain', size: 100 };
      const result = service.validateFile(file);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('invalid characters');
    });

    it('accepts custom MIME types', () => {
      const file = { buffer: Buffer.from('data'), originalname: 'data.xml', mimetype: 'application/xml', size: 100 };
      const result = service.validateFile(file, { allowedMimeTypes: ['application/xml'] });
      expect(result.valid).toBe(true);
    });

    it('rejects with custom max size', () => {
      const file = { buffer: Buffer.alloc(2000), originalname: 'small.txt', mimetype: 'text/plain', size: 2000 };
      const result = service.validateFile(file, { maxSize: 1024 });
      expect(result.valid).toBe(false);
    });
  });
