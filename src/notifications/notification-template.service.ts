import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationTemplate, NotificationChannel } from './entities/notification-template.entity';

export interface RenderedTemplate {
  channel: NotificationChannel;
  subject?: string; // For email
  body: string;
  title?: string; // For push/in-app
}

@Injectable()
export class NotificationTemplateService {
  private readonly logger = new Logger(NotificationTemplateService.name);

  constructor(
    @InjectRepository(NotificationTemplate)
    private readonly templateRepository: Repository<NotificationTemplate>,
  ) {}

  /**
   * Get or create default templates on startup
   */
  async ensureDefaultTemplates() {
    const defaultTemplates = [
      {
        name: 'Trade Executed',
        description: 'Notification when a trade is successfully executed',
        key: 'trade-executed',
        emailSubject: 'Trade Executed - {{amount}} {{symbol}}',
        emailBody: `<p>Your trade has been executed successfully!</p>
          <p>Amount: {{amount}} {{symbol}}</p>
          <p>Price: {{price}}</p>`,
        smsBody: 'Trade executed: {{amount}} {{symbol}} at {{price}}',
        inAppTitle: 'Trade Executed',
        inAppBody: '{{amount}} {{symbol}} @ {{price}}',
        pushTitle: 'Trade Executed',
        pushBody: '{{amount}} {{symbol}} traded',
        fallbackTitle: 'Trade Executed',
        fallbackMessage: 'Your trade has been executed',
        variables: ['amount', 'symbol', 'price'],
      },
      {
        name: 'Low Balance Alert',
        description: 'Alert when account balance is low',
        key: 'low-balance-alert',
        emailSubject: 'Low Balance Alert',
        emailBody: '<p>Your account balance is low: {{balance}} {{currency}}</p>',
        smsBody: 'Low balance: {{balance}} {{currency}}',
        inAppTitle: 'Low Balance',
        inAppBody: 'Your balance is {{balance}} {{currency}}',
        pushTitle: 'Low Balance',
        pushBody: 'Balance: {{balance}} {{currency}}',
        fallbackTitle: 'Low Balance Alert',
        fallbackMessage: 'Your account balance is low',
        variables: ['balance', 'currency'],
      },
    ];

    for (const template of defaultTemplates) {
      const exists = await this.templateRepository.findOne({
        where: { key: template.key },
      });

      if (!exists) {
        await this.templateRepository.save(template);
        this.logger.log(`Created default template: ${template.key}`);
      }
    }
  }

  /**
   * Render a template with provided variables
   */
  async renderTemplate(
    templateKey: string,
    variables: Record<string, any>,
    channels: NotificationChannel[] = [
      NotificationChannel.EMAIL,
      NotificationChannel.SMS,
    ],
  ): Promise<RenderedTemplate[]> {
    const template = await this.templateRepository.findOne({
      where: { key: templateKey, isActive: true },
    });

    if (!template) {
      this.logger.warn(`Template not found: ${templateKey}`);
      return this.getFallbackTemplate(template, variables, channels);
    }

    return channels.map((channel) => this.renderForChannel(template, channel, variables));
  }

  /**
   * Render template for a specific channel
   */
  private renderForChannel(
    template: NotificationTemplate,
    channel: NotificationChannel,
    variables: Record<string, any>,
  ): RenderedTemplate {
    const rendered: RenderedTemplate = { channel, body: '' };

    switch (channel) {
      case NotificationChannel.EMAIL:
        rendered.subject = this.interpolate(template.emailSubject, variables);
        rendered.body = template.emailPlainText
          ? this.interpolate(template.emailPlainText, variables)
          : this.interpolate(template.emailBody, variables);
        break;

      case NotificationChannel.SMS:
        rendered.body = this.interpolate(template.smsBody || template.fallbackMessage, variables);
        break;

      case NotificationChannel.IN_APP:
        rendered.title = this.interpolate(template.inAppTitle || template.fallbackTitle, variables);
        rendered.body = this.interpolate(template.inAppBody || template.fallbackMessage, variables);
        break;

      case NotificationChannel.PUSH:
        rendered.title = this.interpolate(template.pushTitle || template.fallbackTitle, variables);
        rendered.body = this.interpolate(template.pushBody || template.fallbackMessage, variables);
        break;
    }

    return rendered;
  }

  /**
   * Interpolate variables in template string
   */
  private interpolate(template: string, variables: Record<string, any>): string {
    if (!template) return '';

    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      const value = variables[key];
      return value !== undefined ? String(value) : match;
    });
  }

  /**
   * Get fallback template when custom template is not found
   */
  private getFallbackTemplate(
    template: NotificationTemplate | undefined,
    variables: Record<string, any>,
    channels: NotificationChannel[],
  ): RenderedTemplate[] {
    return channels.map((channel) => ({
      channel,
      body: template?.fallbackMessage || 'You have a notification',
      title: template?.fallbackTitle || 'Notification',
    }));
  }

  /**
   * Create or update a template
   */
  async upsertTemplate(templateData: Partial<NotificationTemplate>): Promise<NotificationTemplate> {
    const existing = await this.templateRepository.findOne({
      where: { key: templateData.key },
    });

    if (existing) {
      await this.templateRepository.update(existing.id, templateData);
      return this.templateRepository.findOne({ where: { id: existing.id } });
    }

    return this.templateRepository.save(templateData);
  }

  /**
   * Get all templates
   */
  async getAll(): Promise<NotificationTemplate[]> {
    return this.templateRepository.find();
  }

  /**
   * Get template by key
   */
  async getByKey(key: string): Promise<NotificationTemplate | null> {
    return this.templateRepository.findOne({ where: { key } });
  }
}
