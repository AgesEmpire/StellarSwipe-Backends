export interface TelegramConfig {
  botToken: string;
  webhookUrl?: string;
  pollingEnabled: boolean;
  allowedUpdates: string[];
}
