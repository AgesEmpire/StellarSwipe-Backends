import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ProviderFollower } from './entities/provider-follower.entity';
import { FollowerService } from './services/follower.service';
import { ProvidersController } from './providers.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProviderFollower]),
    EventEmitterModule, // imported at root level; reference here for DI
  ],
  controllers: [ProvidersController],
  providers: [FollowerService],
  exports: [FollowerService], // export so SignalsModule can use it
})
export class ProvidersModule {}
