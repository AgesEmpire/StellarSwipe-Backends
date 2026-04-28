import { IsString, IsOptional } from 'class-validator';

export class DiscordAlertDto {
  @IsString()
  channelId: string;

  @IsString()
  title: string;

  @IsString()
  description: string;

  @IsOptional()
  @IsString()
  color?: string; // hex e.g. '#00ff00'
}
