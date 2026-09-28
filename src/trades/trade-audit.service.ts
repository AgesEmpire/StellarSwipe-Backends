import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit-log/audit.service';
import { AuditAction, AuditStatus } from '../audit-log/entities/audit-log.entity';
import { Trade } from './entities/trade.entity';

export interface TradeAuditContext {
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
}

@Injectable()
export class TradeAuditService {
  constructor(private readonly auditService: AuditService) {}

  async logTradeExecuted(trade: Trade, ctx: TradeAuditContext = {}): Promise<void> {
    await this.auditService.log({
      userId: trade.userId,
      action: AuditAction.TRADE_EXECUTED,
      resource: 'trade',
      resourceId: trade.id,
      status: AuditStatus.SUCCESS,
      metadata: this.safeTradePayload(trade),
      ...ctx,
    });
  }

  async logTradeFailed(
    trade: Trade,
    reason: string,
    ctx: TradeAuditContext = {},
  ): Promise<void> {
    await this.auditService.log({
      userId: trade.userId,
      action: AuditAction.TRADE_EXECUTED,
      resource: 'trade',
      resourceId: trade.id,
      status: AuditStatus.FAILURE,
      errorMessage: reason,
      metadata: this.safeTradePayload(trade),
      ...ctx,
    });
  }

  async logTradeCancelled(trade: Trade, ctx: TradeAuditContext = {}): Promise<void> {
    await this.auditService.log({
      userId: trade.userId,
      action: AuditAction.TRADE_CANCELLED,
      resource: 'trade',
      resourceId: trade.id,
      status: AuditStatus.SUCCESS,
      metadata: this.safeTradePayload(trade),
      ...ctx,
    });
  }

  async logRiskGateDecision(
    userId: string,
    tradeId: string,
    decision: 'allowed' | 'blocked',
    reason: string,
    ctx: TradeAuditContext = {},
  ): Promise<void> {
    await this.auditService.log({
      userId,
      action: AuditAction.TRADE_MODIFIED,
      resource: 'risk_gate',
      resourceId: tradeId,
      status: decision === 'allowed' ? AuditStatus.SUCCESS : AuditStatus.FAILURE,
      metadata: { decision, reason },
      ...ctx,
    });
  }

  async logConfirmationResult(
    trade: Trade,
    txHash: string,
    outcome: 'confirmed' | 'failed' | 'timeout',
    ctx: TradeAuditContext = {},
  ): Promise<void> {
    await this.auditService.log({
      userId: trade.userId,
      action: AuditAction.TRADE_EXECUTED,
      resource: 'tx_confirmation',
      resourceId: trade.id,
      status: outcome === 'confirmed' ? AuditStatus.SUCCESS : AuditStatus.FAILURE,
      metadata: { txHash, outcome },
      ...ctx,
    });
  }

  // ---------------------------------------------------------------------------

  /** Strip wallet private keys / secrets; keep only compliance-relevant fields */
  private safeTradePayload(trade: Trade): Record<string, unknown> {
    return {
      tradeId: trade.id,
      signalId: trade.signalId,
      side: trade.side,
      baseAsset: trade.baseAsset,
      counterAsset: trade.counterAsset,
      amount: trade.amount,
      entryPrice: trade.entryPrice,
      status: trade.status,
      transactionHash: trade.transactionHash,
      sorobanContractId: trade.sorobanContractId,
      feeAmount: trade.feeAmount,
    };
  }
}
