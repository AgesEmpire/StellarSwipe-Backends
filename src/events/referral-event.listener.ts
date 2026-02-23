import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ReferralsService } from '../referrals/referrals.service';

@Injectable()
export class ReferralEventListener {
  private readonly logger = new Logger(ReferralEventListener.name);

  constructor(private readonly referralsService: ReferralsService) {}

  @OnEvent('trade.settled')
  async handleTradeSettled(payload: { tradeId: string; userId: string }) {
    this.logger.log(`Trade settled event received: ${payload.tradeId}`);
    try {
      await this.referralsService.checkAndRewardReferral(payload.tradeId);
    } catch (error) {
      this.logger.error(`Error processing referral reward: ${error}`);
    }
  }

  @OnEvent('referral.rewarded')
  async handleReferralRewarded(payload: {
    referrerId: string;
    referredId: string;
    amount: number;
    txHash: string;
  }) {
    this.logger.log(
      `Referral reward distributed: ${payload.amount} XLM to ${payload.referrerId}`,
    );
    // Here you could send notifications to both users
    // For now, just log the event
  }
}
