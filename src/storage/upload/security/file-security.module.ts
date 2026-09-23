import { Module } from '@nestjs/common';
import { MalwareScanService } from './malware-scan.service';
import { FileSecurityPipe } from './file-security.pipe';

/**
 * Import into any module exposing upload endpoints, then apply
 * `@UploadedFile(new FileSecurityPipe(malwareScanService))` (inject
 * FileSecurityPipe/MalwareScanService via the controller constructor) ahead
 * of persistence logic. Kept as its own module so it can be dropped into
 * FileUploadModule (or any future upload surface) without modifying
 * existing providers.
 */
@Module({
  providers: [MalwareScanService, FileSecurityPipe],
  exports: [MalwareScanService, FileSecurityPipe],
})
export class FileSecurityModule {}
