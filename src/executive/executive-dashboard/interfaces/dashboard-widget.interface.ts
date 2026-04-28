/**
 * DashboardWidget Interface
 * Defines the structure of dashboard widgets for executive dashboard
 */

export interface DashboardWidget {
  id: string;
  type:
    | 'kpi-summary'
    | 'revenue-metrics'
    | 'user-metrics'
    | 'system-health'
    | 'top-signals'
    | 'trade-volume'
    | 'custom';
  title: string;
  description?: string;
  position: {
    row: number;
    column: number;
    width: number; // Grid width (1-12)
    height: number; // Grid height
  };
  refreshInterval: number; // In seconds
  isVisible: boolean;
  isPinned: boolean;
  customConfig?: Record<string, any>;
  lastUpdated: Date;
  cacheKey?: string;
  cacheTTL?: number; // Cache time-to-live in seconds
}

export interface DashboardLayout {
  id: string;
  name: string;
  widgets: DashboardWidget[];
  gridColumns: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface DashboardMetadata {
  totalWidgets: number;
  activeWidgets: number;
  lastSyncTime: Date;
  syncStatus: 'synced' | 'syncing' | 'error';
  layoutVersion: number;
}
