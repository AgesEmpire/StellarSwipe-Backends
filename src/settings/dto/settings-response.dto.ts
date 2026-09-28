import { UserSettingsData } from '../entities/user-settings.entity';

export class SettingsResponseDto {
  userId: string;
  settings: UserSettingsData;
  updatedAt: Date;
  /** Concurrency token — pass back as `expectedVersion` on the next update. */
  version: number;
}
