export const TCP_PATTERNS = {
  GET_USER_PREFERENCES: 'get_user_notification_preferences',
} as const;

export interface GetUserPreferencesRequest {
  userId: string;
}

export interface UserPreferencesResponse {
  userId: string;
  tradeUpdates: { email: boolean; push: boolean };
  signalPerformance: { email: boolean; push: boolean };
  systemAlerts: { email: boolean; push: boolean };
  marketing: { email: boolean; push: boolean };
  updatedAt: Date;
}
