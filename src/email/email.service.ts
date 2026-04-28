import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { SendGridProvider } from './providers/sendgrid.provider';
import { SESProvider } from './providers/ses.provider';
import { SendEmailDto } from './dto/send-email.dto';
import { welcomeTemplate } from './templates/welcome.template';
import { tradeExecutedTemplate } from './templates/trade-executed.template';
import { payoutCompletedTemplate } from './templates/payout-completed.template';
import { securityAlertTemplate, signalPerformanceTemplate, weeklySummaryTemplate, passwordResetTemplate } from './templates/additional.templates';
import { EmailLog } from './entities/email-log.entity';
import { UnsubscribeList } from './entities/unsubscribe-list.entity';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly provider: SendGridProvider | SESProvider;
  private readonly templates = {
    welcome: welcomeTemplate,
    'trade-executed': tradeExecutedTemplate,
    'payout-completed': payoutCompletedTemplate,
    'security-alert': securityAlertTemplate,
    'signal-performance': signalPerformanceTemplate,
    'weekly-summary': weeklySummaryTemplate,
    'password-reset': passwordResetTemplate,
  };

  constructor(
    private configService: ConfigService,
    private sendGridProvider: SendGridProvider,
    private sesProvider: SESProvider,
    @InjectRepository(EmailLog)
    private emailLogRepository: Repository<EmailLog>,
    @InjectRepository(UnsubscribeList)
    private unsubscribeRepository: Repository<UnsubscribeList>,
  ) {
    const emailProvider = this.configService.get<string>('EMAIL_PROVIDER', 'sendgrid');
    this.provider = emailProvider === 'ses' ? this.sesProvider : this.sendGridProvider;
  }

  @Throttle({ default: { limit: 100, ttl: 60000 } }) // 100 emails per minute
  async sendEmail(dto: SendEmailDto): Promise<void> {
    const { to, template, variables } = dto;

    // Check unsubscribe list
    const isUnsubscribed = await this.unsubscribeRepository.findOne({ where: { email: to } });
    if (isUnsubscribed) {
      this.logger.warn(`Email not sent to ${to}: user unsubscribed`);
      throw new BadRequestException('User has unsubscribed from emails');
    }

    // Validate email format
    if (!this.isValidEmail(to)) {
      throw new BadRequestException('Invalid email address');
    }

    // Get template
    const emailTemplate = this.templates[template];
    if (!emailTemplate) {
      throw new BadRequestException(`Template '${template}' not found`);
    }

    // Render template
    const { subject, html } = this.renderTemplate(emailTemplate, variables);

    try {
      // Send email
      const result = await this.provider.sendEmail(to, subject, html);

      // Log delivery
      await this.logEmail(to, subject, template, result.messageId, 'sent');

      this.logger.log(`Email sent successfully to ${to}`);
    } catch (error) {
      await this.logEmail(to, subject, template, null, 'failed', error.message);
      throw error;
    }
  }

  private renderTemplate(template: any, variables: Record<string, any> = {}): { subject: string; html: string } {
    let subject = template.subject;
    let html = template.html;

    // Replace variables
    for (const [key, value] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      subject = subject.replace(regex, value);
      html = html.replace(regex, value);
    }

    // Check for missing variables
    const missingVars = html.match(/{{(\w+)}}/g);
    if (missingVars) {
      throw new BadRequestException(`Missing template variables: ${missingVars.join(', ')}`);
    }

    return { subject, html };
  }

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private async logEmail(
    to: string,
    subject: string,
    template: string,
    messageId: string | null,
    status: string,
    error?: string,
  ): Promise<void> {
    const log = this.emailLogRepository.create({
      to,
      subject,
      template,
      messageId,
      status,
      error,
    });
    await this.emailLogRepository.save(log);
  }

  async handleBounce(email: string, reason: string): Promise<void> {
    this.logger.warn(`Bounce received for ${email}: ${reason}`);
    await this.emailLogRepository.update({ to: email }, { status: 'bounced', error: reason });
  }

  async handleComplaint(email: string): Promise<void> {
    this.logger.warn(`Complaint received for ${email}`);
    await this.unsubscribe(email);
  }

  async unsubscribe(email: string): Promise<void> {
    const existing = await this.unsubscribeRepository.findOne({ where: { email } });
    if (!existing) {
      const unsubscribe = this.unsubscribeRepository.create({ email });
      await this.unsubscribeRepository.save(unsubscribe);
      this.logger.log(`User ${email} unsubscribed`);
    }
  }

  async getDeliveryStatus(messageId: string): Promise<any> {
    return this.emailLogRepository.findOne({ where: { messageId } });
  }
}
