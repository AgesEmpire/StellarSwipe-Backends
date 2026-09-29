export interface DatabasePoolAlertThresholds {
  /** Utilization ratio (0-1) at which the pool is considered saturated. */
  saturationRatio: number;
  /** Utilization ratio (0-1) at which the pool is considered under pressure. */
  pressureRatio: number;
  /** Minimum number of waiting clients before an alert fires. */
  minWaitingClients: number;
  /** Minimum number of idle connections below which pressure is reported. */
  minIdleConnections: number;
}

export interface DatabasePoolMonitoringConfig {
  enabled: boolean;
  /**
   * Bounded label values used for pool metrics. Keep this list small and
   * fixed so metric cardinality stays bounded.
   */
  pools: string[];
  /**
   * Bounded label values describing the pool state. Fixed set keeps
   * cardinality bounded across all emitted samples.
   */
  states: string[];
  alertThresholds: DatabasePoolAlertThresholds;
}

export interface MonitoringConfig {
  databasePool: DatabasePoolMonitoringConfig;
}

const DEFAULT_POOLS = ['primary', 'replica'] as const;
const DEFAULT_STATES = ['active', 'idle', 'waiting'] as const;

const DEFAULT_ALERT_THRESHOLDS: DatabasePoolAlertThresholds = {
  saturationRatio: 0.9,
  pressureRatio: 0.75,
  minWaitingClients: 1,
  minIdleConnections: 1,
};

function readRatio(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

function readCount(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function readBoundedLabels(value: string | undefined, fallback: readonly string[]): string[] {
  if (value === undefined || value.trim() === '') {
    return [...fallback];
  }
  const labels = value
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label.length > 0);
  return labels.length > 0 ? labels : [...fallback];
}

/**
 * Builds the database pool monitoring configuration from the environment.
 * Alert thresholds are configurable via env vars and default to safe values.
 */
export function loadMonitoringConfig(
  env: NodeJS.ProcessEnv = process.env,
): MonitoringConfig {
  return {
    databasePool: {
      enabled: env.DB_POOL_MONITORING_ENABLED !== 'false',
      pools: readBoundedLabels(env.DB_POOL_MONITORING_POOLS, DEFAULT_POOLS),
      states: readBoundedLabels(env.DB_POOL_MONITORING_STATES, DEFAULT_STATES),
      alertThresholds: {
        saturationRatio: readRatio(
          env.DB_POOL_ALERT_SATURATION_RATIO,
          DEFAULT_ALERT_THRESHOLDS.saturationRatio,
        ),
        pressureRatio: readRatio(
          env.DB_POOL_ALERT_PRESSURE_RATIO,
          DEFAULT_ALERT_THRESHOLDS.pressureRatio,
        ),
        minWaitingClients: readCount(
          env.DB_POOL_ALERT_MIN_WAITING_CLIENTS,
          DEFAULT_ALERT_THRESHOLDS.minWaitingClients,
        ),
        minIdleConnections: readCount(
          env.DB_POOL_ALERT_MIN_IDLE_CONNECTIONS,
          DEFAULT_ALERT_THRESHOLDS.minIdleConnections,
        ),
      },
    },
  };
}

export const monitoringConfig: MonitoringConfig = loadMonitoringConfig();
