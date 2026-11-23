import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PositionLifecycleEvent } from './position-lifecycle-event.entity';
import { PositionLifecycleService } from './position-lifecycle.service';
import { PositionLifecycleController } from './position-lifecycle.controller';
import { PositionLifecycleSubscriber } from './position-lifecycle.subscriber';

@Module({
  imports: [TypeOrmModule.forFeature([PositionLifecycleEvent])],
  controllers: [PositionLifecycleController],
  providers: [PositionLifecycleService, PositionLifecycleSubscriber],
  exports: [PositionLifecycleService],
})
export class PositionLifecycleModule {}
