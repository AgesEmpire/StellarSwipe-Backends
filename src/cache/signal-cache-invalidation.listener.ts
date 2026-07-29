import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { CacheInvalidationService } from './cache-invalidation.service';

/**
 * #532 — Signal Cache Invalidation Listener
 *
 * This service listens for signal update events and triggers appropriate
 * cache invalidations to keep the feed and dashboard in sync with the database.
 * This ensures that when signal statuses change, the cached data is immediately
 * invalidated so fresh data is fetched on the next request.
 */
@Injectable()
export class SignalCacheInvalidationListener {
  private readonly logger = new Logger(SignalCacheInvalidationListener.name);

  constructor(private cacheInvalidationService: CacheInvalidationService) {}

  /**
   * Listen for signal creation events and invalidate the feed cache.
   */
  @OnEvent('signal.created', { async: true })
  async handleSignalCreated(payload: {
    signalId: string;
    providerId: string;
    baseAsset: string;
    counterAsset: string;
  }): Promise<void> {
    try {
      this.logger.debug(
        `Signal created: ${payload.signalId} by ${payload.providerId}`,
      );
      const assetPair = `${payload.baseAsset}/${payload.counterAsset}`;
      await this.cacheInvalidationService.invalidateSignalUpdate(
        payload.signalId,
        assetPair,
        payload.providerId,
      );
    } catch (error) {
      this.logger.error('Error handling signal creation cache invalidation', error);
    }
  }

  /**
   * Listen for signal status changes (ACTIVE -> CLOSED, etc).
   */
  @OnEvent('signal.status-changed', { async: true })
  async handleSignalStatusChanged(payload: {
    signalId: string;
    providerId: string;
    newStatus: string;
    oldStatus: string;
    baseAsset: string;
    counterAsset: string;
  }): Promise<void> {
    try {
      this.logger.debug(
        `Signal status changed: ${payload.signalId} from ${payload.oldStatus} to ${payload.newStatus}`,
      );
      const assetPair = `${payload.baseAsset}/${payload.counterAsset}`;
      await this.cacheInvalidationService.invalidateSignalUpdate(
        payload.signalId,
        assetPair,
        payload.providerId,
      );
    } catch (error) {
      this.logger.error('Error handling signal status change cache invalidation', error);
    }
  }

  /**
   * Listen for signal updates (price, performance, etc).
   */
  @OnEvent('signal.updated', { async: true })
  async handleSignalUpdated(payload: {
    signalId: string;
    providerId: string;
    baseAsset: string;
    counterAsset: string;
    changes: Record<string, any>;
  }): Promise<void> {
    try {
      this.logger.debug(
        `Signal updated: ${payload.signalId} with changes: ${Object.keys(
          payload.changes,
        ).join(', ')}`,
      );
      const assetPair = `${payload.baseAsset}/${payload.counterAsset}`;
      await this.cacheInvalidationService.invalidateSignalUpdate(
        payload.signalId,
        assetPair,
        payload.providerId,
      );
    } catch (error) {
      this.logger.error('Error handling signal update cache invalidation', error);
    }
  }

  /**
   * Listen for signal deletion/expiration.
   */
  @OnEvent('signal.expired', { async: true })
  async handleSignalExpired(payload: {
    signalId: string;
    providerId: string;
    baseAsset: string;
    counterAsset: string;
  }): Promise<void> {
    try {
      this.logger.debug(`Signal expired: ${payload.signalId}`);
      const assetPair = `${payload.baseAsset}/${payload.counterAsset}`;
      await this.cacheInvalidationService.invalidateSignalUpdate(
        payload.signalId,
        assetPair,
        payload.providerId,
      );
    } catch (error) {
      this.logger.error('Error handling signal expiration cache invalidation', error);
    }
  }
}
