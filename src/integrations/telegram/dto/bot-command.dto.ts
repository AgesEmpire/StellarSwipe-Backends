import { IsString, IsNumber, IsOptional } from 'class-validator';

export class BotCommandDto {
  @IsNumber()
  telegramId: number;

  @IsString()
  command: string;

  @IsOptional()
  @IsString()
  args?: string;
}
