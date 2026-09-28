import { Injectable, Logger, ConflictException } from '@nestjs/common';
import {
  SorobanRpc,
  TransactionBuilder,
  Keypair,
  BASE_FEE,
  Operation,
  xdr,
} from '@stellar/stellar-sdk';
import { StellarConfigService } from '../../config/stellar.service';
import { SorobanException } from '../../common/exceptions';

export interface DeploymentRecord {
  idempotencyKey: string;
  contractId?: string;
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  lastError?: string;
  deployedAt?: Date;
}

export interface DeployContractOptions {
  wasmHash: string;
  sourceSecret: string;
  idempotencyKey: string;
  maxRetries?: number;
}

const BASE_BACKOFF_MS = 2000;

@Injectable()
export class ContractDeploymentService {
  private readonly logger = new Logger(ContractDeploymentService.name);
  private readonly server: SorobanRpc.Server;
  /** In-memory idempotency store — replace with DB/Redis in production. */
  private readonly deployments = new Map<string, DeploymentRecord>();

  constructor(private readonly stellarConfig: StellarConfigService) {
    this.server = new SorobanRpc.Server(this.stellarConfig.sorobanRpcUrl);
  }

  async deployContract(options: DeployContractOptions): Promise<DeploymentRecord> {
    const { idempotencyKey, maxRetries = this.stellarConfig.maxRetries } = options;

    const existing = this.deployments.get(idempotencyKey);
    if (existing?.status === 'success') {
      this.logger.log(`Idempotency hit — contract already deployed: ${existing.contractId}`);
      throw new ConflictException(
        `Contract already deployed with id ${existing.contractId}`,
      );
    }

    const record: DeploymentRecord = existing ?? {
      idempotencyKey,
      status: 'pending',
      attempts: 0,
    };
    this.deployments.set(idempotencyKey, record);

    return this.attemptDeploy(options, record, maxRetries);
  }

  getDeploymentStatus(idempotencyKey: string): DeploymentRecord | undefined {
    return this.deployments.get(idempotencyKey);
  }

  private async attemptDeploy(
    options: DeployContractOptions,
    record: DeploymentRecord,
    maxRetries: number,
  ): Promise<DeploymentRecord> {
    const { wasmHash, sourceSecret, idempotencyKey } = options;

    while (record.attempts <= maxRetries) {
      record.attempts += 1;
      this.logger.log(
        `Deployment attempt ${record.attempts}/${maxRetries + 1} for key: ${idempotencyKey}`,
      );

      try {
        const contractId = await this.sendDeployTransaction(wasmHash, sourceSecret);
        record.status = 'success';
        record.contractId = contractId;
        record.deployedAt = new Date();
        this.logger.log(`Contract deployed successfully: ${contractId}`);
        return record;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        record.lastError = msg;
        this.logger.warn(
          `Deployment attempt ${record.attempts} failed for ${idempotencyKey}: ${msg}`,
        );

        if (record.attempts > maxRetries) {
          break;
        }

        const delay = BASE_BACKOFF_MS * Math.pow(2, record.attempts - 1);
        this.logger.log(`Retrying in ${delay}ms…`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    record.status = 'failed';
    this.logger.error(
      `Contract deployment failed after ${record.attempts} attempts for key: ${idempotencyKey}`,
    );
    throw new SorobanException(
      `Contract deployment failed after ${record.attempts} attempts`,
    );
  }

  private async sendDeployTransaction(
    wasmHash: string,
    sourceSecret: string,
  ): Promise<string> {
    const keypair = Keypair.fromSecret(sourceSecret);
    const account = await this.server.getAccount(keypair.publicKey());

    const uploadOp = Operation.uploadContractWasm({
      wasm: Buffer.from(wasmHash, 'hex'),
    });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.stellarConfig.networkPassphrase,
    })
      .addOperation(uploadOp)
      .setTimeout(30)
      .build();

    const simulation = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw new SorobanException(`Simulation failed: ${simulation.error}`);
    }

    const prepared = await this.server.prepareTransaction(tx);
    prepared.sign(keypair);

    const response = await this.server.sendTransaction(prepared);
    if (response.status === 'ERROR') {
      throw new SorobanException('Transaction rejected by RPC');
    }

    const confirmed = await this.waitForConfirmation(response.hash);
    if (confirmed.status !== 'SUCCESS') {
      throw new SorobanException(`Transaction did not succeed: ${confirmed.status}`);
    }

    return this.extractContractId(confirmed);
  }

  private async waitForConfirmation(
    hash: string,
  ): Promise<SorobanRpc.Api.GetTransactionResponse> {
    const deadline = Date.now() + this.stellarConfig.apiTimeout;
    while (Date.now() < deadline) {
      const tx = await this.server.getTransaction(hash);
      if (tx.status !== 'PENDING') return tx;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new SorobanException('Timed out waiting for deployment transaction');
  }

  private extractContractId(
    tx: SorobanRpc.Api.GetTransactionResponse,
  ): string {
    try {
      const meta = (tx as any).resultMetaXdr;
      if (meta) {
        const parsed = xdr.TransactionMeta.fromXDR(meta, 'base64');
        const ops = parsed.v3?.operations?.() ?? [];
        for (const op of ops) {
          for (const change of op.changes?.() ?? []) {
            const created = (change as any).created?.();
            const contractData = created?.data?.contractData?.();
            if (contractData) {
              return contractData.contract?.contractId?.()?.toString('hex') ?? hash;
            }
          }
        }
      }
    } catch {
      // fall through to hash-based id
    }
    return (tx as any).hash ?? 'unknown';
  }
}
