import {
  Injectable,
  Logger,
  OnModuleInit,
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
import { SorobanDiagnosticService } from './soroban-diagnostic.service';
import { MaxCallDepthService } from '../common/services/max-call-depth.service';
import { SorobanFeeTrackerService } from '../common/services/soroban-fee-tracker.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { EntrypointKilledException } from '../feature-flags/exceptions/entrypoint-killed.exception';
import { SorobanRpcResilienceService } from './soroban-rpc-resilience.service';

// Optional import for monitoring - will be injected if available
interface SorobanMonitoringService {
  recordFailure(failure: {
    contractId: string;
    method: string;
    error: string;
    timestamp: Date;
    endpoint?: string;
    userId?: string;
  }): void;
}

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

interface SimulationCacheEntry {
  response: SorobanRpc.Api.SimulateTransactionResponse;
  ledgerSequence: number;
  expiresAt: number;
}

const SIMULATION_CACHE_TTL_MS = 5_000;
const SIMULATION_CACHE_MAX_ENTRIES = 500;

@Injectable()
export class SorobanService implements OnModuleInit {
  private readonly logger = new Logger(SorobanService.name);
  private readonly server: SorobanRpc.Server;
  private readonly simulationCache = new Map<string, SimulationCacheEntry>();

  constructor(
    private readonly stellarConfig: StellarConfigService,
    private readonly sorobanMonitoring?: SorobanMonitoringService,
    private readonly diagnosticService: SorobanDiagnosticService,
    private readonly maxCallDepthService?: MaxCallDepthService,
    private readonly feeTrackerService?: SorobanFeeTrackerService,
    private readonly featureFlagsService?: FeatureFlagsService,
    private readonly resilience: SorobanRpcResilienceService,
  ) {
    this.server = new SorobanRpc.Server(this.stellarConfig.sorobanRpcUrl);
  }

  async onModuleInit(): Promise<void> {
    try {
      const startTime = Date.now();
      const health = await this.withTimeout(
        () => this.server.getHealth(),
        'warmup',
        5000,
      );
      const latency = Date.now() - startTime;
      this.logger.log(
        `Soroban RPC warmup completed: ${health.status} (${latency}ms)`,
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown Soroban warmup error';
      this.logger.warn(
        `Soroban RPC warmup failed: ${errorMessage}`,
      );
    }
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

    if (this.featureFlagsService) {
      const accessCheck = await this.featureFlagsService.checkEntrypointAccess(
        contractId,
        method,
      );
      if (!accessCheck.allowed) {
        throw new EntrypointKilledException(contractId, method);
      }
    }

    let sendResponse: { status?: string; hash?: string } | undefined;
    try {
      const sourceKeypair = Keypair.fromSecret(options.sourceSecret);
      const sourceAccount =
        options.sourceAccount || sourceKeypair.publicKey();
      const account = await this.withTimeout(
        () => this.server.getAccount(sourceAccount),
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

      if (this.maxCallDepthService) {
        const depthInfo = this.maxCallDepthService.extractCallDepthFromSimulation(simulation);
        this.maxCallDepthService.validateDepth(
          depthInfo.depth,
          this.stellarConfig.maxCallDepth ?? 5,
          this.stellarConfig.maxCallDepthViolationPolicy ?? 'reject',
          `${contractId}.${method}`,
        );
      }

      const prepared = await this.withTimeout(
        () => this.server.prepareTransaction(transaction),
        'prepareTransaction',
        options.timeoutMs,
      );

      prepared.sign(sourceKeypair);

      sendResponse = await this.withTimeout(
        () => this.server.sendTransaction(prepared),
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

      if (this.feeTrackerService && simulation?.minResourceFee && confirmed.feeCharged) {
        const feeEstimate = this.feeTrackerService.calculateFeeEstimate(
          simulation.minResourceFee,
          confirmed.feeCharged.toString(),
          contractId,
          method,
          sendResponse.hash,
        );
        this.feeTrackerService.logFeeComparison(feeEstimate);
      }

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

      // Parse and log diagnostic events if available
      const txHash = sendResponse?.hash;
      const diagnosticEvents = this.diagnosticService.parseDiagnosticEvents(
        (error as Record<string, unknown>)?.events as Array<Record<string, unknown>> || [],
        txHash,
      );
      this.diagnosticService.logDiagnosticEvents(diagnosticEvents, {
        contractId,
        method,
        txHash,
      });
      
      this.logger.error(
        `Soroban invocation failed for ${contractId}.${method}: ${errorMessage}`,
      );
      
      // Record failure for monitoring
      if (this.sorobanMonitoring) {
        this.sorobanMonitoring.recordFailure({
          contractId,
          method,
          error: errorMessage,
          timestamp: new Date(),
          endpoint: options.sourceAccount,
          userId: options.sourceAccount,
        });
      }
      
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
    const cacheKey = this.buildSimulationCacheKey(transaction);
    const cached = this.simulationCache.get(cacheKey);

    if (cached) {
      const now = Date.now();
      if (cached.expiresAt > now) {
        const currentLedger = await this.getCurrentLedgerSequence();
        if (currentLedger === cached.ledgerSequence) {
          this.logger.debug(`Soroban simulation cache hit: ${cacheKey}`);
          return cached.response;
        }
        this.logger.debug(
          `Soroban simulation cache stale (ledger ${cached.ledgerSequence} -> ${currentLedger}): ${cacheKey}`,
        );
      }
      this.simulationCache.delete(cacheKey);
    }

    const response = await this.withTimeout(
      () => this.server.simulateTransaction(transaction),
      'simulateTransaction',
    );

    const ledgerSequence = await this.getCurrentLedgerSequence();
    this.storeSimulationCacheEntry(cacheKey, response, ledgerSequence);

    return response;
  }

  private buildSimulationCacheKey(transaction: Transaction): string {
    const canonicalInputs = {
      network: this.stellarConfig.networkPassphrase,
      source: transaction.source,
      fee: transaction.fee,
      sequence: transaction.sequence,
      timebounds: transaction.timeBounds ?? null,
      operations: transaction.operations.map((op) => op.toXDR('base64')),
    };
    return JSON.stringify(canonicalInputs);
  }

  private async getCurrentLedgerSequence(): Promise<number> {
    try {
      const latest = await this.withTimeout(
        () => this.server.getLatestLedger(),
        'getLatestLedger',
      );
      return latest.sequence;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown ledger lookup error';
      this.logger.warn(
        `Failed to fetch latest ledger for simulation cache: ${errorMessage}`,
      );
      return -1;
    }
  }

  private storeSimulationCacheEntry(
    cacheKey: string,
    response: SorobanRpc.Api.SimulateTransactionResponse,
    ledgerSequence: number,
  ): void {
    if (this.simulationCache.size >= SIMULATION_CACHE_MAX_ENTRIES) {
      const oldestKey = this.simulationCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.simulationCache.delete(oldestKey);
      }
    }
    this.simulationCache.set(cacheKey, {
      response,
      ledgerSequence,
      expiresAt: Date.now() + SIMULATION_CACHE_TTL_MS,
    });
  }

/* … rest of file unchanged … */
