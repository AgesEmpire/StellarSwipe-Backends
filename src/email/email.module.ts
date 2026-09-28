import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { EmailService } from './email.service';
import { SendGridProvider } from './providers/sendgrid.provider';
import { SESProvider } from './providers/ses.provider';
import { EmailLog } from './entities/email-log.entity';
import { UnsubscribeList } from './entities/unsubscribe-list.entity';
import { TemplateEngineService } from './template-engine.service';
import { EmailTemplateRegistry } from './email-template.registry';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([EmailLog, UnsubscribeList]),
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),
  ],
  providers: [EmailService, SendGridProvider, SESProvider, TemplateEngineService, EmailTemplateRegistry],
  exports: [EmailService, TemplateEngineService],
})
export class EmailModule {}
