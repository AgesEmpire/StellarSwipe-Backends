import { IsString, IsOptional, IsEnum } from 'class-validator';

export enum SocialPlatform {
  TWITTER = 'twitter',
  GENERIC = 'generic',
}

export class SocialExportRequestDto {
  @IsString()
  tradeId: string;

  @IsEnum(SocialPlatform)
  @IsOptional()
  platform?: SocialPlatform;
}

export interface SocialExportPayload {
  headline: string;
  pair: string;
  side: string;
  pnlPercent: string;
  pnlDirection: 'profit' | 'loss' | 'neutral';
  entryPrice: string;
  exitPrice: string | null;
  outcome: string;
  providerHandle: string;
  attribution: string;
  shareText: string;
  platform: SocialPlatform;
  generatedAt: string;
}
