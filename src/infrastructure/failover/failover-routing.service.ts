import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
  FailoverConfigDto,
  FailoverEvent,
  RegionConfig,
} from './dto/failover-config.dto';

interface RegionHealthState {
  healthy: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

@Injectable()
export class FailoverRoutingService {
  private readonly logger = new Logger(FailoverRoutingService.name);

  private config: FailoverConfigDto | null = null;
  private readonly regionHealth = new Map<string, RegionHealthState>();
  private currentRegion = '';
  private readonly failoverHistory: FailoverEvent[] = [];

  constructor(private readonly configService: ConfigService) {}

  initialize(config: FailoverConfigDto): void {
    this.config = config;
    this.currentRegion = config.primaryRegion;

    const allRegions = [
      config.primaryRegion,
      ...config.failoverRegions.map((r) => r.name),
    ];
    for (const region of allRegions) {
      this.regionHealth.set(region, {
        healthy: true,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      });
    }

    this.logger.log(`Failover routing initialized. Primary region: ${config.primaryRegion}`);
  }

  async checkRegionHealth(region: RegionConfig): Promise<boolean> {
    try {
      await axios.get(region.healthCheckUrl, { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  async runHealthChecks(): Promise<void> {
    if (!this.config) return;

    for (const region of this.config.failoverRegions) {
      if (!region.enabled) continue;

      const isHealthy = await this.checkRegionHealth(region);
      const state = this.regionHealth.get(region.name) ?? {
        healthy: true,
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
      };

      if (isHealthy) {
        state.consecutiveFailures = 0;
        state.consecutiveSuccesses += 1;
        if (
          !state.healthy &&
          state.consecutiveSuccesses >= this.config.recoveryThreshold
        ) {
          state.healthy = true;
          this.logger.log(`Region ${region.name} recovered`);
        }
      } else {
        state.consecutiveSuccesses = 0;
        state.consecutiveFailures += 1;
        if (state.consecutiveFailures >= this.config.failureThreshold) {
          state.healthy = false;
          this.logger.warn(
            `Region ${region.name} marked unhealthy after ${state.consecutiveFailures} failures`,
          );
          if (this.currentRegion === region.name) {
            this.triggerFailover(`Region ${region.name} exceeded failure threshold`);
          }
        }
      }

      this.regionHealth.set(region.name, state);
    }
  }

  getActiveRegion(): string {
    return this.currentRegion;
  }

  shouldFailover(): boolean {
    const state = this.regionHealth.get(this.currentRegion);
    return state ? !state.healthy : false;
  }

  triggerFailover(reason: string, requestPath?: string): string | null {
    if (!this.config) return null;

    const candidate = this.config.failoverRegions
      .filter((r) => r.enabled && this.regionHealth.get(r.name)?.healthy)
      .sort((a, b) => a.priority - b.priority)[0];

    if (!candidate) {
      this.logger.error('Failover triggered but no healthy region available');
      return null;
    }

    const event: FailoverEvent = {
      triggeredAt: new Date(),
      fromRegion: this.currentRegion,
      toRegion: candidate.name,
      reason,
      requestPath,
    };

    this.failoverHistory.push(event);
    this.logger.warn(
      `Failover: ${event.fromRegion} → ${event.toRegion} (reason: ${reason})`,
    );

    this.currentRegion = candidate.name;
    return candidate.endpoint;
  }

  getFailoverHistory(): FailoverEvent[] {
    return this.failoverHistory;
  }

  getRegionStatus(): Record<string, { healthy: boolean; region: string }> {
    const result: Record<string, { healthy: boolean; region: string }> = {};
    for (const [region, state] of this.regionHealth.entries()) {
      result[region] = { healthy: state.healthy, region };
    }
    return result;
  }
}
