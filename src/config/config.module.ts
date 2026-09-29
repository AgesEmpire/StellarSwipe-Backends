import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { CredentialRotationService } from './credential-rotation.service';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
    }),
  ],
  providers: [CredentialRotationService],
  exports: [CredentialRotationService],
})
export class ConfigModule {}
