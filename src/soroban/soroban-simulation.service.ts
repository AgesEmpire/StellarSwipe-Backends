import { Injectable, Logger } from '@nestjs/common';
import {
  SorobanRpc,
  Contract,
  TransactionBuilder,
  Keypair,
  Account,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { StellarConfigService } from '../config/stellar.service';
import { SorobanException } from '../common/exceptions';
import { SimulateContractDto } from './dto/simulate-contract.dto';
import { SimulateContractResponseDto } from './dto/simulate-contract-response.dto';

/**
 * Runs Soroban `simulateTransaction` (preflight) for a proposed contract call
 * and returns the estimated fee, minimum resource fee, result, and footprint
 * **without** broadcasting the transaction.
 *
 * Error taxonomy surfaced to callers:
 *   - `simulationError`  — the contract itself would revert (e.g. assertion failed)
 *   - `rpcError`         — the Soroban RPC was unreachable or returned a protocol error
 */
@Injectable()
export class SorobanSimulationService {
  private readonly logger = new Logger(SorobanSimulationService.name);
  private readonly server: SorobanRpc.Server;

  constructor(private readonly stellarConfig: StellarConfigService) {
    this.server = new SorobanRpc.Server(this.stellarConfig.sorobanRpcUrl);
  }

  async simulate(dto: SimulateContractDto): Promise<SimulateContractResponseDto> {
    this.logger.log(
      `Preflight simulate: contractId=${dto.contractId} method=${dto.method}`,
    );

    try {
      const transaction = await this.buildSimulationTransaction(dto);
      const simulation = await this.callSimulateRpc(transaction, dto.timeoutMs);

      return this.parseSimulationResponse(simulation);
    } catch (error) {
      // Distinguish RPC connectivity errors from contract revert errors
      if (error instanceof SorobanException) {
        this.logger.warn(
          `Soroban RPC error during simulation for ${dto.contractId}.${dto.method}: ${error.message}`,
        );
        return {
          success: false,
          rpcError: error.message,
        };
      }

      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Unexpected error during simulation for ${dto.contractId}.${dto.method}: ${msg}`,
      );
      return {
        success: false,
        rpcError: `Unexpected error: ${msg}`,
      };
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async buildSimulationTransaction(
    dto: SimulateContractDto,
  ): Promise<ReturnType<TransactionBuilder['build']>> {
    // Resolve source account: prefer an explicitly provided public key,
    // fall back to deriving from the secret, or use the neutral simulation key.
    let sourcePublicKey: string;

    if (dto.sourceAccount) {
      sourcePublicKey = dto.sourceAccount;
    } else if (dto.sourceSecret) {
      sourcePublicKey = Keypair.fromSecret(dto.sourceSecret).publicKey();
    } else {
      // Use a well-known simulation-only account (no real balance needed for preflight)
      sourcePublicKey =
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    }

    // For simulation we don't need the actual on-ledger sequence number.
    // Use a synthetic account with seq=0 so we never hit the network for account info.
    const account = new Account(sourcePublicKey, '0');

    const contract = new Contract(dto.contractId);
    const scArgs = (dto.params ?? []).map((p) => this.toScVal(p));
    const operation = contract.call(dto.method, ...scArgs);

    return new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.stellarConfig.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();
  }

  private async callSimulateRpc(
    transaction: ReturnType<TransactionBuilder['build']>,
    timeoutMs?: number,
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    const timeout = timeoutMs ?? this.stellarConfig.apiTimeout;
    let handle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      handle = setTimeout(
        () => reject(new SorobanException(`simulateTransaction timed out after ${timeout}ms`)),
        timeout,
      );
    });

    try {
      return await Promise.race([
        this.server.simulateTransaction(transaction),
        timeoutPromise,
      ]);
    } catch (error) {
      if (error instanceof SorobanException) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw new SorobanException(`RPC simulateTransaction failed: ${msg}`);
    } finally {
      if (handle) clearTimeout(handle);
    }
  }

  private parseSimulationResponse(
    simulation: SorobanRpc.Api.SimulateTransactionResponse,
  ): SimulateContractResponseDto {
    // Contract-level revert — distinct from RPC errors
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      this.logger.warn(`Contract simulation revert: ${simulation.error}`);
      return {
        success: false,
        simulationError: simulation.error,
      };
    }

    const minResourceFee = simulation.minResourceFee ?? '0';
    const resourceFee = minResourceFee;

    // Inclusion fee: use feeStats p95 if available, fall back to BASE_FEE
    const inclusionFee = BASE_FEE;
    const totalFee = (BigInt(resourceFee) + BigInt(inclusionFee)).toString();

    // Parse return value
    let result: unknown;
    const restoreSim = simulation as SorobanRpc.Api.SimulateTransactionRestoreResponse;
    const successSim = simulation as SorobanRpc.Api.SimulateTransactionSuccessResponse;

    if (successSim.result?.retval) {
      result = this.parseScVal(successSim.result.retval);
    }

    // Footprint from transaction data
    let footprint: SimulateContractResponseDto['footprint'];
    const txData = (simulation as any).transactionData;
    if (txData) {
      try {
        const data =
          typeof txData === 'string'
            ? xdr.SorobanTransactionData.fromXDR(txData, 'base64')
            : txData;
        const ledgerFootprint = data.resources().footprint();
        footprint = {
          readOnly: ledgerFootprint
            .readOnly()
            .map((e: xdr.LedgerKey) => e.toXDR('base64')),
          readWrite: ledgerFootprint
            .readWrite()
            .map((e: xdr.LedgerKey) => e.toXDR('base64')),
        };
      } catch {
        // Non-fatal: footprint parsing is best-effort
      }
    }

    // Auth entries
    let auth: string[] | undefined;
    if (successSim.result?.auth && successSim.result.auth.length > 0) {
      auth = successSim.result.auth.map((a) =>
        typeof a === 'string' ? a : (a as xdr.SorobanAuthorizationEntry).toXDR('base64'),
      );
    }

    return {
      success: true,
      resourceFee,
      minResourceFee,
      inclusionFee: inclusionFee.toString(),
      totalFee,
      result,
      footprint,
      auth,
    };
  }

  private toScVal(param: unknown): xdr.ScVal {
    if (param instanceof xdr.ScVal) return param;
    try {
      return nativeToScVal(param);
    } catch {
      throw new SorobanException(
        `Cannot convert simulation parameter to ScVal: ${JSON.stringify(param)}`,
      );
    }
  }

  private parseScVal(value: unknown): unknown {
    if (!value) return undefined;
    if (value instanceof xdr.ScVal) {
      try {
        return scValToNative(value);
      } catch {
        return (value as xdr.ScVal).toXDR('base64');
      }
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
}
