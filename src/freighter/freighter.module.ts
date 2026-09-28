import { Module } from '@nestjs/common';
import { FreighterService } from './freighter.service';
import { FreighterController } from './freighter.controller';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [FreighterController],
  providers: [FreighterService],
  exports: [FreighterService],
})
export class FreighterModule {}
