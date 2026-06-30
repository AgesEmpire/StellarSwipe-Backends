import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { BaseEvent } from '../../events/base.event';
import { OutboxService } from '../../events/outbox.service';
import { 
  HorizonStreamEvent, 
  HorizonTransaction, 
  HorizonOperation, 
  HorizonEffect,
  ProcessedEvent,
  TradeEvent,
  PaymentEvent,
  TrustlineEvent,
  AccountMergeEvent
} from '../interfaces/horizon-event.interface';

@Injectable()
export class EventProcessorService {
  private readonly logger = new Logger(EventProcessorService.name);

  constructor(private readonly outboxService: OutboxService) {}

  @OnEvent('horizon.transaction')
  async handleTransactionEvent(payload: { accountId: string; event: HorizonStreamEvent }): Promise<void> {
    const { accountId, event } = payload;
    
    try {
      if (!event.successful) {
        this.logger.debug(`Skipping failed transaction: ${event.hash}`);
        return;
      }

      const transaction = event.data as HorizonTransaction;
      
      // Fetch operations for this transaction
      await this.processTransactionOperations(accountId, transaction);
      
      this.logger.debug(`Processed transaction ${transaction.hash} for account ${accountId}`);
      
    } catch (error) {
      this.logger.error(`Error processing transaction event for ${accountId}:`, error);
    }
  }

  @OnEvent('horizon.effect')
  async handleEffectEvent(payload: { accountId: string; event: HorizonStreamEvent }): Promise<void> {
    const { accountId, event } = payload;
    
    try {
      const effect = event.data as HorizonEffect;
      const processedEvent = await this.processEffect(accountId, effect);
      
      if (processedEvent) {
        await this.outboxService.enqueue(
          new StellarProcessedEvent(
            `stellar.${processedEvent.eventType}`,
            processedEvent,
            processedEvent.eventId,
          ),
        );
        this.logger.debug(`Queued processed ${processedEvent.eventType} event for account ${accountId}`);
      }
      
    } catch (error) {
      this.logger.error(`Error processing effect event for ${accountId}:`, error);
    }
  }

  private async processTransactionOperations(accountId: string, transaction: HorizonTransaction): Promise<void> {
    try {
      // In a real implementation, you'd fetch operations from the transaction
      // For now, we'll emit a general transaction confirmation event
      const processedEvent: ProcessedEvent = {
        eventId: transaction.id,
        eventType: 'payment', // This would be determined by operation type
        accountId,
        transactionHash: transaction.hash,
        ledger: transaction.ledger,
        timestamp: new Date(transaction.created_at),
        data: {
          sourceAccount: transaction.source_account,
          operationCount: transaction.operation_count,
          successful: transaction.successful,
        },
      };

      await this.outboxService.enqueue(
        new StellarProcessedEvent(
          'stellar.transaction.confirmed',
          processedEvent,
          processedEvent.eventId,
        ),
      );
      
    } catch (error) {
      this.logger.error(`Error processing transaction operations:`, error);
    }
  }

  private async processEffect(accountId: string, effect: HorizonEffect): Promise<ProcessedEvent | null> {
    switch (effect.type) {
      case 'account_credited':
      case 'account_debited':
        return this.processPaymentEffect(accountId, effect);
        
      case 'trade':
        return this.processTradeEffect(accountId, effect);
        
      case 'trustline_created':
      case 'trustline_updated':
      case 'trustline_removed':
        return this.processTrustlineEffect(accountId, effect);
        
      case 'account_merged':
        return this.processAccountMergeEffect(accountId, effect);
        
      default:
        this.logger.debug(`Unhandled effect type: ${effect.type}`);
        return null;
    }
  }

  private processPaymentEffect(accountId: string, effect: HorizonEffect): PaymentEvent {
    return {
      eventId: effect.id,
      eventType: 'payment',
      accountId,
      transactionHash: '', // Would need to be fetched from effect
      ledger: 0, // Would need to be fetched
      timestamp: new Date(effect.created_at),
      data: {
        from: effect.type === 'account_debited' ? accountId : 'unknown',
        to: effect.type === 'account_credited' ? accountId : 'unknown',
        amount: effect.amount || '0',
        asset: {
          type: effect.asset_type || 'native',
          code: effect.asset_code,
          issuer: effect.asset_issuer,
        },
      },
    };
  }

  private processTradeEffect(accountId: string, effect: HorizonEffect): TradeEvent {
    return {
      eventId: effect.id,
      eventType: 'trade',
      accountId,
      transactionHash: '', // Would need to be fetched
      ledger: 0, // Would need to be fetched
      timestamp: new Date(effect.created_at),
      data: {
        seller: effect.seller || accountId,
        buyer: accountId,
        soldAmount: effect.sold_amount || '0',
        soldAsset: {
          type: effect.sold_asset_type || 'native',
          code: effect.sold_asset_code,
          issuer: effect.sold_asset_issuer,
        },
        boughtAmount: effect.bought_amount || '0',
        boughtAsset: {
          type: effect.bought_asset_type || 'native',
          code: effect.bought_asset_code,
          issuer: effect.bought_asset_issuer,
        },
        price: this.calculateTradePrice(
          effect.sold_amount || '0',
          effect.bought_amount || '0'
        ),
        offerId: effect.offer_id || '0',
      },
    };
  }

  private processTrustlineEffect(accountId: string, effect: HorizonEffect): TrustlineEvent {
    let action: 'created' | 'updated' | 'removed';
    
    switch (effect.type) {
      case 'trustline_created':
        action = 'created';
        break;
      case 'trustline_updated':
        action = 'updated';
        break;
      case 'trustline_removed':
        action = 'removed';
        break;
      default:
        action = 'updated';
    }

    return {
      eventId: effect.id,
      eventType: 'trustline',
      accountId,
      transactionHash: '', // Would need to be fetched
      ledger: 0, // Would need to be fetched
      timestamp: new Date(effect.created_at),
      data: {
        trustor: effect.trustor || accountId,
        asset: {
          code: effect.asset_code || '',
          issuer: effect.asset_issuer || '',
        },
        limit: effect.limit || '0',
        action,
      },
    };
  }

  private processAccountMergeEffect(accountId: string, effect: HorizonEffect): AccountMergeEvent {
    return {
      eventId: effect.id,
      eventType: 'account_merge',
      accountId,
      transactionHash: '', // Would need to be fetched
      ledger: 0, // Would need to be fetched
      timestamp: new Date(effect.created_at),
      data: {
        account: accountId,
        destination: 'unknown', // Would need to be extracted from operation
      },
    };
  }

  private calculateTradePrice(soldAmount: string, boughtAmount: string): string {
    try {
      const sold = parseFloat(soldAmount);
      const bought = parseFloat(boughtAmount);
      
      if (bought === 0) return '0';
      
      return (sold / bought).toFixed(7);
    } catch (error) {
      this.logger.error('Error calculating trade price:', error);
      return '0';
    }
  }

  // Event handlers for processed events
  @OnEvent('stellar.payment')
  handlePaymentEvent(event: PaymentEvent): void {
    this.logger.log(`Payment processed: ${event.data.amount} ${event.data.asset.code || 'XLM'} from ${event.data.from} to ${event.data.to}`);
    
    // Here you could:
    // - Update user balances in database
    // - Send notifications
    // - Update portfolio calculations
  }

  @OnEvent('stellar.trade')
  handleTradeEvent(event: TradeEvent): void {
    this.logger.log(`Trade processed: ${event.data.soldAmount} ${event.data.soldAsset.code || 'XLM'} for ${event.data.boughtAmount} ${event.data.boughtAsset.code || 'XLM'}`);
    
    // Here you could:
    // - Update trade history
    // - Calculate P&L
    // - Update portfolio positions
    // - Send trade notifications
  }

  @OnEvent('stellar.trustline')
  handleTrustlineEvent(event: TrustlineEvent): void {
    this.logger.log(`Trustline ${event.data.action}: ${event.data.asset.code} for ${event.accountId}`);
    
    // Here you could:
    // - Update user's available assets
    // - Refresh portfolio calculations
    // - Send trustline notifications
  }

  @OnEvent('stellar.account_merge')
  handleAccountMergeEvent(event: AccountMergeEvent): void {
    this.logger.warn(`SECURITY ALERT: Account merge detected for ${event.accountId}`);
    
    // Here you could:
    // - Send security alerts
    // - Disable account access
    // - Log security event
  }

  @OnEvent('stellar.transaction.confirmed')
  handleTransactionConfirmed(event: ProcessedEvent): void {
    this.logger.log(`Transaction confirmed: ${event.transactionHash} for account ${event.accountId}`);
    
    // Here you could:
    // - Update transaction status in database
    // - Send confirmation notifications
    // - Update UI state
  }

  // Utility methods for filtering events
  isRelevantForAccount(accountId: string, event: HorizonStreamEvent): boolean {
    // Check if the event is relevant for the given account
    if (event.source_account === accountId) return true;
    
    // For effects, check the account field
    if (event.type === 'effect') {
      const effect = event.data as HorizonEffect;
      return effect.account === accountId;
    }
    
    return false;
  }

  shouldProcessEvent(event: HorizonStreamEvent): boolean {
    // Only process successful events
    if (!event.successful && event.type === 'transaction') {
      return false;
    }
    
    // Filter by event types we care about
    const relevantEffectTypes = [
      'account_credited',
      'account_debited',
      'trade',
      'trustline_created',
      'trustline_updated',
      'trustline_removed',
      'account_merged',
    ];
    
    if (event.type === 'effect') {
      const effect = event.data as HorizonEffect;
      return relevantEffectTypes.includes(effect.type);
    }
    
    return true;
  }
}

class StellarProcessedEvent extends BaseEvent {
  readonly eventName: string;

  constructor(eventName: string, payload: unknown, correlationId?: string) {
    super(correlationId);
    this.eventName = eventName;
    Object.assign(this, payload);
  }

  validate(): void {
    return;
  }
}