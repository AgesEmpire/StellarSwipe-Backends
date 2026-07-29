import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { WithdrawalOtp } from './entities/withdrawal-otp.entity';
import { WithdrawalOtpService } from './withdrawal-otp.service';
import { WithdrawalOtpController } from './withdrawal-otp.controller';
import { WithdrawalOtpGuard } from './guards/withdrawal-otp.guard';
import { AuthModule } from '../../auth/auth.module';
import { EmailModule } from '../../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([WithdrawalOtp]),
    ConfigModule,
    AuthModule,
    EmailModule,
  ],
  controllers: [WithdrawalOtpController],
  providers: [WithdrawalOtpService, WithdrawalOtpGuard],
  exports: [WithdrawalOtpService, WithdrawalOtpGuard],
})
export class WithdrawalOtpModule {}
