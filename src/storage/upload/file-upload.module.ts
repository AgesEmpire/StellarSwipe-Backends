import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FileUploadService } from './file-upload.service';
import { FileUploadController } from './file-upload.controller';
import { MultipartCleanupInterceptor } from './multipart-cleanup.interceptor';
import { ArchiveImportGuardService } from './security/archive-import-guard.service';

@Module({
  imports: [ConfigModule],
  controllers: [FileUploadController],
  providers: [FileUploadService, MultipartCleanupInterceptor, ArchiveImportGuardService],
  exports: [FileUploadService, ArchiveImportGuardService],
})
export class FileUploadModule {}

