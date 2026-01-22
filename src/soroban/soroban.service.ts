import {
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  SorobanRpc,
  Contract,
  TransactionBuilder,
  Keypair,
  xdr,
  BASE_FEE,
  Account,
  Operation,
  scValToNative,
  nativeToScVal,
  Transaction,
} from '@stellar/stellar-sdk';
import { StellarConfigService } from '../config/stellar.service';
import { SorobanException } from '../common/exceptions';
import {
  ContractEvent,
  ContractResult,
} from './interfaces/contract-result.interface';

interface FeeEstimate {
  inclusionFee: string;
  resourceFee: string;
  totalFee: string;
}

interface InvokeOptions {
  sourceSecret?: string;
  sourceAccount?: string;
  timeoutMs?: number;
}

@Injectable()
export class SorobanService {
  private readonly logger = new Logger(SorobanService.name);
  private readonly server: SorobanRpc.Server;

  constructor(private readonly stellarConfig: StellarConfigService) {
    this.server = new SorobanRpc.Server(this.stellarConfig.sorobanRpcUrl);
  }

  async invokeContract(
    contractId: string,
    method: string,
    params: unknown[],
    options: InvokeOptions = {},
  ): Promise<ContractResult> {
    if (!contractId || !method) {
      throw new SorobanException(
        'Contract ID and method are required',
        contractId,
        method,
      );
    }

    if (!options.sourceSecret) {
      throw new SorobanException(
        'Missing source secret for contract invocation',
        contractId,
        method,
      );
    }

    try {
      const sourceKeypair = Keypair.fromSecret(options.sourceSecret);
      const sourceAccount =
        options.sourceAccount || sourceKeypair.publicKey();
      const account = await this.withTimeout(
        this.server.getAccount(sourceAccount),
        'getAccount',
        options.timeoutMs,
      );
      const operation = this.buildContractOperation(
        contractId,
        method,
        params,
      );

      const transaction = new TransactionBuilder(account, {
        fee: BASE_FEE,
        networkPassphrase: this.stellarConfig.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const simulation = await this.simulateTransaction(transaction);
      const prepared = await this.withTimeout(
        this.server.prepareTransaction(transaction),
        'prepareTransaction',
        options.timeoutMs,
      );

      prepared.sign(sourceKeypair);

      const sendResponse = await this.withTimeout(
        this.server.sendTransaction(prepared),
        'sendTransaction',
        options.timeoutMs,
      );

      if (sendResponse.status === 'ERROR') {
        throw new SorobanException(
          'Soroban transaction rejected',
          contractId,
          method,
          sendResponse,
        );
      }

      if (!sendResponse.hash) {
        throw new SorobanException(
          'Soroban transaction did not return a hash',
          contractId,
          method,
          sendResponse,
        );
      }

      const confirmed = await this.waitForTransaction(
        sendResponse.hash,
        options.timeoutMs,
      );
      const events = await this.getContractEvents(sendResponse.hash);
      const result = this.parseScVal(simulation?.result?.retval);

      const success = confirmed.status === 'SUCCESS';

      return {
        success,
        hash: sendResponse.hash,
        status: confirmed.status,
        result,
        events,
        feeCharged: confirmed.feeCharged?.toString(),
        error: success
          ? undefined
          : (confirmed as Record<string, unknown>).errorResultXdr?.toString() ||
            (confirmed as Record<string, unknown>).resultXdr?.toString() ||
            confirmed.status,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown Soroban error';
      this.logger.error(
        `Soroban invocation failed for ${contractId}.${method}: ${errorMessage}`,
      );
      if (error instanceof SorobanException) {
        throw error;
      }

      throw new SorobanException(
        errorMessage,
        contractId,
        method,
        error,
      );
    }
  }

  async simulateTransaction(
    transaction: Transaction,
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    const simulation = await this.withTimeout(
      this.server.simulateTransaction(transaction),
      'simulateTransaction',
    );

    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new SorobanException(
        `Simulation failed: ${simulation.error}`,
      );
    }

    return simulation;
  }

  async getContractEvents(
    txHash: string,
  ): Promise<ContractEvent[]> {
    if (!txHash) {
      return [];
    }

    const transaction = await this.withTimeout(
      this.server.getTransaction(txHash),
      'getTransaction',
    );

    if (transaction.status !== 'SUCCESS') {
      return [];
    }

    return this.parseEvents(transaction.events || []);
  }

  async estimateFees(operation: Operation): Promise<FeeEstimate> {
    const mockAccount = this.getSimulationAccount();
    const transaction = new TransactionBuilder(mockAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.stellarConfig.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    const simulation = await this.simulateTransaction(transaction);
    const resourceFee = this.toBigInt(
      simulation.minResourceFee || '0',
    );
    const feeStats = await this.withTimeout(
      typeof (this.server as any).getFeeStats === 'function'
        ? (this.server as any).getFeeStats()
        : Promise.resolve({}),
      'getFeeStats',
    );
    const inclusionFee = this.resolveInclusionFee(feeStats || {});
    const totalFee = inclusionFee + resourceFee;

    return {
      inclusionFee: inclusionFee.toString(),
      resourceFee: resourceFee.toString(),
      totalFee: totalFee.toString(),
    };
  }

  private buildContractOperation(
    contractId: string,
    method: string,
    params: unknown[],
  ): Operation {
    const contract = new Contract(contractId);
    const scVals = (params || []).map((param) =>
      this.toScVal(param),
    );
    return contract.call(method, ...scVals);
  }

  private toScVal(param: unknown): xdr.ScVal {
    if (param instanceof xdr.ScVal) {
      return param;
    }

    if (
      param &&
      typeof param === 'object' &&
      'scVal' in param &&
      (param as { scVal: unknown }).scVal instanceof xdr.ScVal
    ) {
      return (param as { scVal: xdr.ScVal }).scVal;
    }

    try {
      return nativeToScVal(param);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'Invalid contract parameter';
      throw new SorobanException(errorMessage);
    }
  }

  private parseScVal(value?: unknown): unknown {
    if (!value) {
      return undefined;
    }

    if (value instanceof xdr.ScVal) {
      return scValToNative(value);
    }

    if (typeof value === 'string') {
      try {
        return scValToNative(xdr.ScVal.fromXDR(value, 'base64'));
      } catch {
        return value;
      }
    }

    return value;
  }

  private parseEvents(
    events: Array<Record<string, unknown>>,
  ): ContractEvent[] {
    return events.map((event) => ({
      type: String(event.type || 'unknown'),
      contractId:
        (event.contractId as string | undefined) ||
        (event.contract_id as string | undefined),
      topics: Array.isArray(event.topic || event.topics)
        ? (event.topic || event.topics)?.map((topic: unknown) =>
            this.parseScVal(topic),
          )
        : undefined,
      data: this.parseScVal(event.data || event.value),
    }));
  }

  private async waitForTransaction(
    txHash: string,
    timeoutMs?: number,
  ): Promise<SorobanRpc.Api.GetTransactionResponse> {
    const deadline =
      Date.now() + (timeoutMs || this.stellarConfig.apiTimeout);
    let attempt = 0;

    while (Date.now() < deadline) {
      const response = await this.withTimeout(
        this.server.getTransaction(txHash),
        'getTransaction',
        timeoutMs,
      );

      if (response.status && response.status !== 'PENDING') {
        return response;
      }

      const delayMs = Math.min(2000 * (attempt + 1), 8000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      attempt += 1;
    }

    throw new SorobanException(
      'Timed out waiting for Soroban transaction',
    );
  }

  private getSimulationAccount(): Account {
    return new Account(
      'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
      '0',
    );
  }

  private resolveInclusionFee(feeStats: Record<string, any>): bigint {
    const inclusionFee =
      feeStats?.sorobanInclusionFee ||
      feeStats?.inclusionFee ||
      feeStats?.feeCharged;
    const feeCandidate =
      inclusionFee?.p95 ||
      inclusionFee?.max ||
      inclusionFee?.mode ||
      inclusionFee?.min;

    if (feeCandidate !== undefined) {
      return this.toBigInt(feeCandidate);
    }

    return this.toBigInt(BASE_FEE);
  }

  private toBigInt(value: string | number | bigint): bigint {
    if (typeof value === 'bigint') {
      return value;
    }

    return BigInt(String(value));
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    label: string,
    timeoutMs?: number,
  ): Promise<T> {
    const timeout = timeoutMs || this.stellarConfig.apiTimeout;
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(
          new SorobanException(
            `Soroban ${label} timed out after ${timeout}ms`,
          ),
        );
      }, timeout);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
    }
  }
}
