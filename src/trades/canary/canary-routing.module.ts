import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CanaryRoutingService } from './canary-routing.service';
import { CanaryRoutingConfig } from './canary-routing.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CanaryRoutingConfig])],
  providers: [CanaryRoutingService],
  exports: [CanaryRoutingService],
})
export class CanaryRoutingModule {}
