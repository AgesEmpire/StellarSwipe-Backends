import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { VersionManagerService } from './version-manager.service';

@ApiTags('versioning')
@Controller('versions')
export class VersionsController {
  constructor(private readonly versionManager: VersionManagerService) {}

  @Get()
  @ApiOperation({ summary: 'List API versions with status, deprecation and sunset metadata' })
  list() {
    return {
      defaultVersion: this.versionManager.getDefaultVersion(),
      supportedVersions: this.versionManager.getSupportedVersions(),
      versions: this.versionManager.getAllVersionInfo(),
    };
  }
}
