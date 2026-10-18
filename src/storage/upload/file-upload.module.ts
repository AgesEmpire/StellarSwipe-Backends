import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FileUploadService } from './file-upload.service';
import { FileUploadController } from './file-upload.controller';
import { MultipartCleanupInterceptor } from './multipart-cleanup.interceptor';

@Module({
  imports: [ConfigModule],
  controllers: [FileUploadController],
  providers: [FileUploadService, MultipartCleanupInterceptor],
  exports: [FileUploadService],
})
export class FileUploadModule {}
