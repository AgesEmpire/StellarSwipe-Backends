import { IsString, IsNumber, IsOptional } from 'class-validator';

export class TelegramAlertDto {
  @IsNumber()
  telegramId: number;

  @IsString()
  message: string;

  @IsOptional()
  @IsString()
  parseMode?: 'HTML' | 'Markdown';
}
