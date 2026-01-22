import { SorobanService } from '../soroban.service';
import { ContractResult } from '../interfaces/contract-result.interface';

export class TradeExecutorContract {
  constructor(
    private readonly sorobanService: SorobanService,
    private readonly contractId: string,
  ) {}

  invoke(
    method: string,
    params: unknown[] = [],
    options?: { sourceSecret?: string; sourceAccount?: string; timeoutMs?: number },
  ): Promise<ContractResult> {
    return this.sorobanService.invokeContract(
      this.contractId,
      method,
      params,
      options,
    );
  }
}
