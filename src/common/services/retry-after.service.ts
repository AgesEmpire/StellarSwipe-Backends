import { Injectable } from '@nestjs/common';

export interface RateLimitWindow {
  resetTime: number;
}

@Injectable()
export class RetryAfterService {
  computeRetryAfter(window: RateLimitWindow, now: number = Date.now()): number {
    const remaining = window.resetTime - now;
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  formatRetryAfter(seconds: number): string {
    return String(seconds);
  }

  fromResetTimestamp(resetTimeMs: number, now: number = Date.now()): string {
    const seconds = this.computeRetryAfter({ resetTime: resetTimeMs }, now);
    return this.formatRetryAfter(seconds);
  }

  fromResetDelta(deltaMs: number): string {
    const seconds = Math.max(0, Math.ceil(deltaMs / 1000));
    return this.formatRetryAfter(seconds);
  }
}
