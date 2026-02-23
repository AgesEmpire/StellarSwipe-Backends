import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SignalTemplate } from './entities/signal-template.entity';
import { SignalTemplateService } from './signal-template.service';
import { SignalTemplateController } from './signal-template.controller';

@Module({
  imports: [TypeOrmModule.forFeature([SignalTemplate])],
  controllers: [SignalTemplateController],
  providers: [SignalTemplateService],
  exports: [SignalTemplateService], // export so other modules (e.g. SignalsModule) can call generateSignal
})
export class SignalTemplateModule {}
