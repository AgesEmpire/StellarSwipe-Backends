import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MigrationService } from './migration.service';
import { MigrationController } from './migration.controller';

@Module({
  imports: [TypeOrmModule.forFeature([])],
  providers: [MigrationService],
  controllers: [MigrationController],
  exports: [MigrationService],
})
export class MigrationModule {}