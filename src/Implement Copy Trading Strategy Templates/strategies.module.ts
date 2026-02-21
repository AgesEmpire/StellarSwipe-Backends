import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';
import { StrategyTemplate } from './entities/strategy-template.entity';
import { UserStrategy } from './entities/user-strategy.entity';

@Module({
  imports: [TypeOrmModule.forFeature([StrategyTemplate, UserStrategy])],
  controllers: [StrategiesController],
  providers: [StrategiesService],
  exports: [StrategiesService],
})
export class StrategiesModule {}
