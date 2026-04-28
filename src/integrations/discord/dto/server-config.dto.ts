import { IsString, IsOptional } from 'class-validator';

export class ServerConfigDto {
  @IsString()
  guildId: string;

  @IsString()
  guildName: string;

  @IsOptional()
  @IsString()
  alertChannelId?: string;

  @IsOptional()
  @IsString()
  announcementChannelId?: string;
}
