import {
  Controller,
  Post,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FilesService } from './files.service';
import { CreateFileMetadataDto } from './dto/create-file-metadata.dto';
import { InitUploadDto } from './dto/init-upload.dto';

/**
 * Maximum allowed size (in bytes) for JSON request bodies on file metadata
 * and upload initialization endpoints. Configurable via the
 * FILE_METADATA_MAX_BODY_BYTES environment variable.
 */
const DEFAULT_MAX_BODY_BYTES = 64 * 1024; // 64 KB

function resolveMaxBodyBytes(): number {
  const raw = process.env.FILE_METADATA_MAX_BODY_BYTES;
  if (!raw) {
    return DEFAULT_MAX_BODY_BYTES;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MAX_BODY_BYTES;
  }
  return Math.floor(parsed);
}

@Controller('files')
export class FilesController {
  private readonly maxBodyBytes = resolveMaxBodyBytes();

  constructor(private readonly filesService: FilesService) {}

  /**
   * Reject oversized payloads before any persistence happens.
   */
  private assertBodySize(body: unknown): void {
    const serialized = JSON.stringify(body ?? {});
    const size = Buffer.byteLength(serialized, 'utf8');
    if (size > this.maxBodyBytes) {
      throw new PayloadTooLargeException(
        `Request body exceeds the maximum allowed size of ${this.maxBodyBytes} bytes`,
      );
    }
  }

  @Post('metadata')
  async createMetadata(@Body() body: CreateFileMetadataDto) {
    this.assertBodySize(body);
    return this.filesService.createMetadata(body);
  }

  @Post('upload/init')
  async initUpload(@Body() body: InitUploadDto) {
    this.assertBodySize(body);
    return this.filesService.initUpload(body);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() body: Record<string, unknown>,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    this.assertBodySize(body);
    return this.filesService.upload(file, body);
  }
}
