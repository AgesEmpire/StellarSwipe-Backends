import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AchievementsService } from '../achievements.service';
import {
  TradeExecutedPayload,
  SignalCreatedPayload,
  SignalCopiedPayload,
} from '../dto/user-achievements.dto';

/**
 * Achievement Event Listener
 *
 * Subscribes to domain events emitted elsewhere in the app (e.g. trading
 * module, signals module) and delegates achievement evaluation to
 * AchievementsService.
 *
 * Event names follow the pattern:  domain.action
 *   • trade.executed
 *   • signal.created
 *   • signal.copied
 *   • trade.month_closed      (emitted by a scheduler after each calendar month)
 *   • achievement.awarded     (emitted by AchievementsService itself – used to send notifications)
 */
@Injectable()
export class AchievementEventListener {
  private readonly logger = new Logger(AchievementEventListener.name);

  constructor(private readonly achievementsService: AchievementsService) {}

  // ─── Trade events ─────────────────────────────────────────────────────────

  @OnEvent('trade.executed', { async: true })
  async onTradeExecuted(payload: TradeExecutedPayload) {
    this.logger.debug(`trade.executed → user=${payload.userId} profit=${payload.profit}`);
    try {
      await this.achievementsService.handleTradeExecuted(payload);
    } catch (err) {
      this.logger.error('Error evaluating achievements for trade.executed', err);
    }
  }

  @OnEvent('trade.month_closed', { async: true })
  async onMonthClosed(payload: { userId: string; netProfit: number }) {
    if (payload.netProfit > 0) {
      this.logger.debug(`trade.month_closed → user=${payload.userId} profit=${payload.netProfit}`);
      try {
        await this.achievementsService.handleProfitableMonth(payload.userId);
      } catch (err) {
        this.logger.error('Error evaluating achievements for trade.month_closed', err);
      }
    }
  }

  // ─── Signal events ────────────────────────────────────────────────────────

  @OnEvent('signal.created', { async: true })
  async onSignalCreated(payload: SignalCreatedPayload) {
    this.logger.debug(`signal.created → user=${payload.userId}`);
    try {
      await this.achievementsService.handleSignalCreated(payload);
    } catch (err) {
      this.logger.error('Error evaluating achievements for signal.created', err);
    }
  }

  @OnEvent('signal.copied', { async: true })
  async onSignalCopied(payload: SignalCopiedPayload) {
    this.logger.debug(`signal.copied → provider=${payload.providerId} totalCopies=${payload.totalCopies}`);
    try {
      await this.achievementsService.handleSignalCopied(payload);
    } catch (err) {
      this.logger.error('Error evaluating achievements for signal.copied', err);
    }
  }

  // ─── Notification hook ────────────────────────────────────────────────────

  /**
   * Fired by AchievementsService after every successful award.
   * Replace the logger call with your NotificationsService / push / WebSocket.
   */
  @OnEvent('achievement.awarded', { async: true })
  async onAchievementAwarded(payload: {
    userId: string;
    achievement: { name: string; rarity: string; badgeImage: string };
    awardedAt: Date;
  }) {
    this.logger.log(
      `🔔 Notification → user=${payload.userId} earned [${payload.achievement.name}] (${payload.achievement.rarity})`,
    );

    /**
     * TODO: inject and call your NotificationsService here, e.g.:
     *
     * await this.notificationsService.send({
     *   userId:  payload.userId,
     *   title:   `Badge Earned: ${payload.achievement.name}`,
     *   body:    `You just unlocked a ${payload.achievement.rarity} badge! 🏅`,
     *   imageUrl: payload.achievement.badgeImage,
     *   type:    'achievement',
     * });
     */
  }
}
