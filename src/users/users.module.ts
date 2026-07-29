import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UserPreference } from './entities/user-preference.entity';
import { Session } from './entities/session.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { CacheInvalidationService } from '../cache/cache-invalidation.service';
import { RetentionPurgeService } from '../privacy/retention-purge.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, UserPreference, Session])],
  controllers: [UsersController],
  providers: [UsersService, CacheInvalidationService, RetentionPurgeService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule { }
