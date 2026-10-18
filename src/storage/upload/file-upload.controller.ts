import {
  Controller,
  Post,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiConsumes, ApiBody, ApiResponse } from '@nestjs/swagger';
import { promises as fs } from 'fs';
import { FileUploadService } from './file-upload.service';
import { FileUploadResponseDto, BatchFileUploadResponseDto } from './dto/file-upload-response.dto';
import { DEFAULT_MAX_FILE_SIZE } from './interfaces/file-upload.interface';
import { multipartDiskStorage } from './multipart-temp-storage';
import { MultipartCleanupInterceptor } from './multipart-cleanup.interceptor';

@ApiTags('File Upload')
@Controller('storage/upload')
export class FileUploadController {
  constructor(private readonly fileUploadService: FileUploadService) {}

  @Post('single')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: multipartDiskStorage,
      limits: { fileSize: DEFAULT_MAX_FILE_SIZE },
    }),
    MultipartCleanupInterceptor,
  )
  @ApiOperation({ summary: 'Upload a single file with validation' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
          description: 'The file to upload (max 5MB)',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'File uploaded successfully',
    type: FileUploadResponseDto,
  })
  @ApiResponse({ status: 413, description: 'File too large' })
  @ApiResponse({ status: 415, description: 'Unsupported media type' })
  async uploadSingle(@UploadedFile() file: Express.Multer.File): Promise<FileUploadResponseDto> {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    // `multipartDiskStorage` streams the part to a temp file rather than
    // buffering it in memory; `MultipartCleanupInterceptor` removes that
    // temp file once this request settles (success, failure, or disconnect).
    const buffer = await fs.readFile(file.path);
    return this.fileUploadService.storeFile({
      buffer,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    });
  }

  @Post('batch')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FilesInterceptor('files', 10, {
      storage: multipartDiskStorage,
      limits: { fileSize: DEFAULT_MAX_FILE_SIZE },
    }),
    MultipartCleanupInterceptor,
  )
  @ApiOperation({ summary: 'Upload multiple files with validation (max 10 files)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'Files to upload (max 10 files, each max 5MB)',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Files processed (some may have failed validation)',
    type: BatchFileUploadResponseDto,
  })
  async uploadBatch(@UploadedFiles() files: Express.Multer.File[]): Promise<BatchFileUploadResponseDto> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }

    const loaded = await Promise.all(
      files.map(async (f) => ({
        buffer: await fs.readFile(f.path),
        originalname: f.originalname,
        mimetype: f.mimetype,
        size: f.size,
      })),
    );
    const result = await this.fileUploadService.storeFiles(loaded);

    return {
      files: result.files,
      failed: result.failed.map((f) => ({ errors: f.errors })),
    };
  }
}
