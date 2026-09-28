export interface DiscordEmbed {
  title: string;
  description: string;
  color: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
}

export function buildEmbed(
  title: string,
  description: string,
  color: number,
  fields?: DiscordEmbed['fields'],
): DiscordEmbed {
  return { title, description, color, fields, timestamp: new Date().toISOString() };
}

export const COLORS = {
  success: 0x00c853,
  danger: 0xff1744,
  info: 0x2979ff,
  warning: 0xffd600,
  neutral: 0x607d8b,
} as const;
