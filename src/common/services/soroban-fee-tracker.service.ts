import { Injectable, Logger } from '@nestjs/common';

export interface FeeEstimate {
  simulatedFee: string;
  actualFee: string;
  delta: string;
  deltaPercentage: number;
  contractId?: string;
  method?: string;
  hash?: string;
  timestamp: Date;
}

@Injectable()
export class SorobanFeeTrackerService {
  private readonly logger = new Logger(SorobanFeeTrackerService.name);

  logFeeComparison(estimate: FeeEstimate): void {
    this.logger.log(
      `[SorobanFee] Contract: ${estimate.contractId}.${estimate.method} | ` +
      `Hash: ${estimate.hash} | ` +
      `Simulated: ${estimate.simulatedFee} stroops | ` +
      `Actual: ${estimate.actualFee} stroops | ` +
      `Delta: ${estimate.delta} stroops (${estimate.deltaPercentage.toFixed(2)}%)`,
    );

    this.emitFeeMetric(estimate);
  }

  private emitFeeMetric(estimate: FeeEstimate): void {
    const deltaNum = parseInt(estimate.delta, 10);
    const simulatedNum = parseInt(estimate.simulatedFee, 10);

    const metric = {
      name: 'soroban_fee_delta_stroops',
      value: deltaNum,
      tags: {
        contract: estimate.contractId,
        method: estimate.method,
        direction: deltaNum >= 0 ? 'overestimated' : 'underestimated',
      },
      timestamp: estimate.timestamp,
    };

    this.logger.debug(
      `[SorobanFeeMetric] Delta distribution: ${JSON.stringify(metric)}`,
    );
  }

  calculateFeeEstimate(
    simulatedFee: string,
    actualFee: string,
    contractId?: string,
    method?: string,
    hash?: string,
  ): FeeEstimate {
    const simulated = parseInt(simulatedFee, 10);
    const actual = parseInt(actualFee, 10);
    const delta = actual - simulated;
    const deltaPercentage = simulated > 0 ? (delta / simulated) * 100 : 0;

    return {
      simulatedFee,
      actualFee,
      delta: delta.toString(),
      deltaPercentage,
      contractId,
      method,
      hash,
      timestamp: new Date(),
    };
  }
}
