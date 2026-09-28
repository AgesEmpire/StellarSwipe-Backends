export interface DiscordConfig {
  botToken: string;
  clientId: string;
  guildId?: string; // optional: restrict to single guild
}
