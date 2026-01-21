import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BetaAccessController } from './beta-access.controller';
import { BetaAccessService } from './beta-access.service';
import { InviteCode } from './entities/invite-code.entity';
import { BetaUser } from './entities/beta-user.entity';
import { Waitlist } from './entities/waitlist.entity';
import { Feedback } from './entities/feedback.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([InviteCode, BetaUser, Waitlist, Feedback]),
  ],
  controllers: [BetaAccessController],
  providers: [BetaAccessService],
  exports: [BetaAccessService],
})
export class BetaModule {}
