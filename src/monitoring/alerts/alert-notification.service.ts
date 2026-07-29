import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';

interface AlertData {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  timestamp: Date;
  metrics: any;
  message: string;
}

@Injectable()
export class AlertNotificationService {
  private readonly logger = new Logger(AlertNotificationService.name);
  private readonly webhookUrl: string;
  private readonly slackChannel: string;

  constructor(private readonly configService: ConfigService) {
    this.webhookUrl = this.configService.get('ALERT_WEBHOOK_URL', '');
    this.slackChannel = this.configService.get('SLACK_ALERT_CHANNEL', '#ops-alerts');
  }

  @OnEvent('alert.soroban.failure')
  async handleSorobanAlert(alertData: AlertData): Promise<void> {
    this.logger.log(`Processing Soroban alert: ${alertData.type}`);
    
    try {
      await Promise.all([
        this.sendWebhookNotification(alertData),
        this.sendSlackNotification(alertData),
        this.logToMonitoringSystem(alertData),
      ]);
    } catch (error) {
      this.logger.error(`Failed to send alert notifications: ${error.message}`);
    }
  }

  private async sendWebhookNotification(alertData: AlertData): Promise<void> {
    if (!this.webhookUrl) return;

    const payload = {
      alert_type: alertData.type,
      severity: alertData.severity,
      timestamp: alertData.timestamp.toISOString(),
      message: alertData.message,
      metrics: alertData.metrics,
      source: 'stellarswipe-backend',
    };

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook returned ${response.status}`);
      }

      this.logger.log('Webhook notification sent successfully');
    } catch (error) {
      this.logger.error(`Webhook notification failed: ${error.message}`);
    }
  }

  private async sendSlackNotification(alertData: AlertData): Promise<void> {
    const slackWebhook = this.configService.get('SLACK_WEBHOOK_URL');
    if (!slackWebhook) return;

    const color = this.getSeverityColor(alertData.severity);
    const payload = {
      channel: this.slackChannel,
      username: 'StellarSwipe Alerts',
      icon_emoji: ':warning:',
      attachments: [
        {
          color,
          title: `🚨 Soroban Alert: ${alertData.type}`,
          text: alertData.message,
          fields: [
            {
              title: 'Severity',
              value: alertData.severity.toUpperCase(),
              short: true,
            },
            {
              title: 'Failure Count',
              value: alertData.metrics.failureCount.toString(),
              short: true,
            },
            {
              title: 'Affected Endpoints',
              value: alertData.metrics.affectedEndpoints.join(', ') || 'N/A',
              short: false,
            },
          ],
          timestamp: Math.floor(alertData.timestamp.getTime() / 1000),
        },
      ],
    };

    try {
      const response = await fetch(slackWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Slack webhook returned ${response.status}`);
      }

      this.logger.log('Slack notification sent successfully');
    } catch (error) {
      this.logger.error(`Slack notification failed: ${error.message}`);
    }
  }

  private async logToMonitoringSystem(alertData: AlertData): Promise<void> {
    // Log structured alert data for monitoring dashboards
    this.logger.log('MONITORING_ALERT', {
      type: alertData.type,
      severity: alertData.severity,
      timestamp: alertData.timestamp,
      metrics: alertData.metrics,
      message: alertData.message,
    });
  }

  private getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical': return 'danger';
      case 'high': return 'warning';
      case 'medium': return '#ff9500';
      case 'low': return 'good';
      default: return '#808080';
    }
  }
}