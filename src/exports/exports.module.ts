import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { BulkExport } from './entities/bulk-export.entity';
import { ExportsService, EXPORT_QUEUE } from './exports.service';
import { ExportsController } from './exports.controller';
import { ExportProcessor } from './export.processor';

@Module({
  imports: [
    TypeOrmModule.forFeature([BulkExport]),
    BullModule.registerQueue({ name: EXPORT_QUEUE }),
  ],
  controllers: [ExportsController],
  providers: [ExportsService, ExportProcessor],
  exports: [ExportsService],
})
export class ExportsModule {}
