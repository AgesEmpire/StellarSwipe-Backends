import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { ApiKeysService } from './api-keys.service';
import { TenantAwareApiKeysService } from './tenant-aware-api-keys.service';
import { ApiKeysController } from './api-keys.controller';
import { ApiKey } from './entities/api-key.entity';
import { ApiKeyAuthGuard } from './guards/api-key-auth.guard';
import { TenantAwareApiKeyGuard } from './guards/tenant-aware-api-key.guard';

@Module({
  imports: [TypeOrmModule.forFeature([ApiKey]), CacheModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, TenantAwareApiKeysService, ApiKeyAuthGuard, TenantAwareApiKeyGuard],
  exports: [ApiKeysService, TenantAwareApiKeysService, ApiKeyAuthGuard, TenantAwareApiKeyGuard],
})
export class ApiKeysModule {}
