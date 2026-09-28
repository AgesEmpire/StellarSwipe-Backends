export interface MobileConfig {
  maxPayloadSize: number; // bytes
  imageQuality: number; // 0-100
  pollingIntervalMs: number;
  deltaWindowMs: number;
  supportedPlatforms: ('ios' | 'android')[];
}

export interface MobileRequestContext {
  platform: 'ios' | 'android';
  appVersion: string;
  networkType: 'wifi' | 'cellular' | 'offline';
  batteryLevel?: number;
}
