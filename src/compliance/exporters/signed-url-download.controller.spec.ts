import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { SignedUrlDownloadController } from './signed-url-download.controller';
import { SignedUrlGeneratorService } from './signed-url-generator.service';

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(),
}));

import { readFile } from 'fs/promises';
import { existsSync } from 'fs';

describe('SignedUrlDownloadController', () => {
  let controller: SignedUrlDownloadController;
  let signedUrlGenerator: jest.Mocked<SignedUrlGeneratorService>;
  let mockResponse: jest.Mocked<Response>;

  beforeEach(async () => {
    signedUrlGenerator = {
      generateSignedUrl: jest.fn(),
      validateAndDecodeSignedUrl: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SignedUrlDownloadController],
      providers: [
        {
          provide: SignedUrlGeneratorService,
          useValue: signedUrlGenerator,
        },
      ],
    }).compile();

    controller = module.get<SignedUrlDownloadController>(SignedUrlDownloadController);

    mockResponse = {
      setHeader: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('downloadExportFile', () => {
    it('should reject request without token', async () => {
      await expect(controller.downloadExportFile(undefined as any, mockResponse)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject request with empty token', async () => {
      await expect(controller.downloadExportFile('', mockResponse)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should reject expired signed URL', async () => {
      const expiredError = new Error('Signed URL has expired (expired at 2026-01-01T00:00:00.000Z)');
      signedUrlGenerator.validateAndDecodeSignedUrl.mockImplementation(() => {
        throw expiredError;
      });

      await expect(controller.downloadExportFile('some-token', mockResponse)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject tampered signed URL', async () => {
      const tamperError = new Error('Signed URL signature verification failed — URL may have been tampered with');
      signedUrlGenerator.validateAndDecodeSignedUrl.mockImplementation(() => {
        throw tamperError;
      });

      await expect(controller.downloadExportFile('some-token', mockResponse)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('should reject malformed signed URL', async () => {
      const malformError = new Error('Invalid signed URL format — failed to decode base64');
      signedUrlGenerator.validateAndDecodeSignedUrl.mockImplementation(() => {
        throw malformError;
      });

      await expect(controller.downloadExportFile('some-token', mockResponse)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should return 404 if export file not found', async () => {
      signedUrlGenerator.validateAndDecodeSignedUrl.mockReturnValue({
        exportId: 'export-123',
        exportType: 'tax-report',
        userId: 'user-456',
        filePath: '/tmp/exports/missing-file.pdf',
        format: 'pdf',
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        signature: 'sig',
      });

      (existsSync as jest.Mock).mockReturnValue(false);

      await expect(controller.downloadExportFile('valid-token', mockResponse)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should successfully download export file', async () => {
      const fileContent = Buffer.from('file data');

      signedUrlGenerator.validateAndDecodeSignedUrl.mockReturnValue({
        exportId: 'export-123',
        exportType: 'tax-report',
        userId: 'user-456',
        filePath: '/tmp/exports/tax_report.pdf',
        format: 'pdf',
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        signature: 'sig',
      });

      (existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue(fileContent);

      await controller.downloadExportFile('valid-token', mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('tax-report-'),
      );
      expect(mockResponse.send).toHaveBeenCalledWith(fileContent);
    });

    it('should set appropriate MIME type for CSV', async () => {
      signedUrlGenerator.validateAndDecodeSignedUrl.mockReturnValue({
        exportId: 'export-123',
        exportType: 'user-data',
        userId: 'user-456',
        filePath: '/tmp/exports/data.csv',
        format: 'csv',
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        signature: 'sig',
      });

      (existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue(Buffer.from('data'));

      await controller.downloadExportFile('valid-token', mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    });

    it('should set appropriate MIME type for JSON', async () => {
      signedUrlGenerator.validateAndDecodeSignedUrl.mockReturnValue({
        exportId: 'export-123',
        exportType: 'user-data',
        userId: 'user-456',
        filePath: '/tmp/exports/data.json',
        format: 'json',
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        signature: 'sig',
      });

      (existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue(Buffer.from('{}'));

      await controller.downloadExportFile('valid-token', mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
    });

    it('should set cache-control headers', async () => {
      signedUrlGenerator.validateAndDecodeSignedUrl.mockReturnValue({
        exportId: 'export-123',
        exportType: 'user-data',
        userId: 'user-456',
        filePath: '/tmp/exports/data.pdf',
        format: 'pdf',
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        signature: 'sig',
      });

      (existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue(Buffer.from('pdf data'));

      await controller.downloadExportFile('valid-token', mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Cache-Control',
        'no-cache, no-store, must-revalidate',
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
      expect(mockResponse.setHeader).toHaveBeenCalledWith('Expires', '0');
    });

    it('should handle file read errors gracefully', async () => {
      signedUrlGenerator.validateAndDecodeSignedUrl.mockReturnValue({
        exportId: 'export-123',
        exportType: 'user-data',
        userId: 'user-456',
        filePath: '/tmp/exports/data.pdf',
        format: 'pdf',
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        signature: 'sig',
      });

      (existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockRejectedValue(new Error('Permission denied'));

      await expect(controller.downloadExportFile('valid-token', mockResponse)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should generate appropriate filename for download', async () => {
      signedUrlGenerator.validateAndDecodeSignedUrl.mockReturnValue({
        exportId: 'export-123',
        exportType: 'compliance-audit',
        userId: 'user-456',
        filePath: '/tmp/exports/audit.csv',
        format: 'csv',
        issuedAt: Math.floor(Date.now() / 1000),
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        signature: 'sig',
      });

      (existsSync as jest.Mock).mockReturnValue(true);
      (readFile as jest.Mock).mockResolvedValue(Buffer.from('audit data'));

      await controller.downloadExportFile('valid-token', mockResponse);

      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('compliance-audit'),
      );
      expect(mockResponse.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        expect.stringContaining('.csv'),
      );
    });
  });
});
