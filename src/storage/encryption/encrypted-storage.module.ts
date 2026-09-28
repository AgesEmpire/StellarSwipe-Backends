import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SecurityModule } from '../../security/security.module';
import { EncryptedStorageService } from './encrypted-storage.service';
import { EncryptedPayloadRecord } from './entities/encrypted-payload.entity';

@Module({
  imports: [TypeOrmModule.forFeature([EncryptedPayloadRecord]), SecurityModule],
  providers: [EncryptedStorageService],
  exports: [EncryptedStorageService],
})
export class EncryptedStorageModule {}
