import { Injectable, Logger } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  BatchOrderDto,
  BatchOrderItemDto,
  BatchOrderItemFailure,
  BatchOrderItemSuccess,
  BatchOrderResponseDto,
} from './dto/batch-order.dto';
import { TradesService } from './trades.service';
import { ExecuteTradeDto } from './dto/execute-trade.dto';

@Injectable()
export class BatchOrderService {
  private readonly logger = new Logger(BatchOrderService.name);

  constructor(private readonly tradesService: TradesService) {}

  async submitBatch(dto: BatchOrderDto): Promise<BatchOrderResponseDto> {
    const accepted: BatchOrderItemSuccess[] = [];
    const rejected: BatchOrderItemFailure[] = [];

    for (let i = 0; i < dto.orders.length; i++) {
      const raw = dto.orders[i];

      // Re-validate the individual item using class-validator so we get
      // per-field error messages rather than the parent array's errors.
      const item = plainToInstance(BatchOrderItemDto, raw);
      const violations = await validate(item, { whitelist: true, forbidNonWhitelisted: true });

      if (violations.length > 0) {
        const errors = violations.flatMap((v) => Object.values(v.constraints ?? {}));
        rejected.push({ index: i, status: 'rejected', errors });
        continue;
      }

      try {
        const tradeDto = plainToInstance(ExecuteTradeDto, {
          userId: item.userId,
          signalId: item.signalId,
          side: item.side,
          amount: item.amount,
          stopLossPrice: item.stopLossPrice,
          takeProfitPrice: item.takeProfitPrice,
          slippageTolerance: item.slippageTolerance,
          walletAddress: item.walletAddress,
        });

        const result = await this.tradesService.executeTrade(tradeDto);
        accepted.push({ index: i, status: 'accepted', result });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Trade execution failed';
        rejected.push({ index: i, status: 'rejected', errors: [message] });
        this.logger.warn(`Batch order index ${i} failed: ${message}`);
      }
    }

    return {
      accepted,
      rejected,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
    };
  }
}
