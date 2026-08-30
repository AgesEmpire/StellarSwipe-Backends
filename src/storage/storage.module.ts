import { Module } from '@nestjs/common';
import { STORAGE_PROVIDER } from './storage-provider.interface';
import { LocalStorageProvider } from './local-storage.provider';

/**
 * Opt-in module exposing StorageProvider via DI token. Not wired into
 * AppModule yet - import this where storage is needed and swap
 * LocalStorageProvider for a cloud provider (S3/GCS) per environment.
 */
@Module({
  providers: [
    {
      provide: STORAGE_PROVIDER,
      useClass: LocalStorageProvider,
    },
  ],
  exports: [STORAGE_PROVIDER],
})
export class StorageModule {}
