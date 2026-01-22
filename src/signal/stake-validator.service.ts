import {
  Injectable,
  ForbiddenException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SorobanRpc,
  Contract,
  TransactionBuilder,
  Networks,
  Account,
  BASE_FEE,
  xdr,
} from '@stellar/stellar-sdk';

export interface StakeInfo {
  amount: string;
  lockedUntil: number;
  isActive: boolean;
}

@Injectable()
export class StakeValidatorService {
  private readonly logger = new Logger(StakeValidatorService.name);
  private readonly server: SorobanRpc.Server;
  private readonly contract: Contract;
  private readonly minimumStake: bigint;
  private readonly networkPassphrase: string;

  constructor(private readonly configService: ConfigService) {
    // Initialize Soroban RPC server
    const rpcUrl =
      this.configService.get<string>('SOROBAN_RPC_URL') ||
      'https://soroban-testnet.stellar.org';
    this.server = new SorobanRpc.Server(rpcUrl);

    // Initialize contract
    const contractId = this.configService.get<string>('STAKE_CONTRACT_ID');
    if (!contractId) {
      throw new Error('STAKE_CONTRACT_ID not configured');
    }
    this.contract = new Contract(contractId);

    // Set minimum stake (in stroops, 1 XLM = 10^7 stroops)
    // Default: 1000 XLM
    const minStake = this.configService.get<string>('MINIMUM_STAKE') || '1000';
    this.minimumStake = BigInt(parseFloat(minStake) * 10_000_000);

    // Network passphrase
    const network = this.configService.get<string>('STELLAR_NETWORK') || 'testnet';
    this.networkPassphrase =
      network === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;

    this.logger.log(
      `StakeValidator initialized with minimum stake: ${minStake} XLM`,
    );
  }

  /**
   * Queries the Soroban contract to get stake information for a provider
   */
  async getProviderStake(providerAddress: string): Promise<StakeInfo> {
    try {
      this.logger.debug(
        `Querying stake for provider: ${providerAddress}`,
      );

      // Build the contract call to get_stake
      const accountId = xdr.ScAddress.scAddressTypeAccount(
        xdr.PublicKey.publicKeyTypeEd25519(
          Buffer.from(providerAddress, 'hex').subarray(0, 32),
        ),
      );

      const operation = this.contract.call(
        'get_stake',
        xdr.ScVal.scvAddress(accountId),
      );

      // Create a mock source account for simulation
      const mockSource = new Account(
        'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        '0',
      );

      const transaction = new TransactionBuilder(mockSource, {
        fee: BASE_FEE,
        networkPassphrase: this.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      // Simulate the transaction to read the contract state
      const simulation = await this.server.simulateTransaction(transaction);

      if (SorobanRpc.Api.isSimulationError(simulation)) {
        throw new Error(
          `Simulation failed: ${simulation.error}`,
        );
      }

      if (!simulation.result) {
        throw new Error('No result from simulation');
      }

      // Parse the result
      const resultValue = simulation.result.retval;
      const stakeInfo = this.parseStakeResult(resultValue);

      this.logger.debug(
        `Stake info retrieved: ${JSON.stringify(stakeInfo)}`,
      );

      return stakeInfo;
    } catch (error) {
      this.logger.error(
        `Failed to query stake for ${providerAddress}: ${error.message}`,
      );
      throw new ServiceUnavailableException(
        'Unable to verify stake at this time. Please try again later.',
      );
    }
  }

  /**
   * Parses the Soroban contract result into StakeInfo
   */
  private parseStakeResult(resultValue: xdr.ScVal): StakeInfo {
    try {
      // Assuming the contract returns a struct with: { amount: u128, locked_until: u64, is_active: bool }
      if (resultValue.switch() === xdr.ScValType.scvMap()) {
        const map = resultValue.map();
        const result: any = {};

        map.forEach((entry) => {
          const key = entry.key().sym().toString();
          const val = entry.val();

          switch (key) {
            case 'amount':
              result.amount = this.scValToString(val);
              break;
            case 'locked_until':
              result.lockedUntil = Number(this.scValToString(val));
              break;
            case 'is_active':
              result.isActive = val.switch() === xdr.ScValType.scvBool() && val.b();
              break;
          }
        });

        return result as StakeInfo;
      }

      throw new Error('Unexpected result format from contract');
    } catch (error) {
      this.logger.error(`Failed to parse stake result: ${error.message}`);
      throw new ServiceUnavailableException(
        'Failed to parse stake information',
      );
    }
  }

  /**
   * Converts ScVal to string representation
   */
  private scValToString(val: xdr.ScVal): string {
    switch (val.switch()) {
      case xdr.ScValType.scvU32():
        return val.u32().toString();
      case xdr.ScValType.scvI32():
        return val.i32().toString();
      case xdr.ScValType.scvU64():
        return val.u64().toString();
      case xdr.ScValType.scvI64():
        return val.i64().toString();
      case xdr.ScValType.scvU128():
        return val.u128().toString();
      case xdr.ScValType.scvI128():
        return val.i128().toString();
      default:
        return '0';
    }
  }

  /**
   * Validates that the provider has sufficient stake
   */
  async validateProviderStake(providerAddress: string): Promise<StakeInfo> {
    const stakeInfo = await this.getProviderStake(providerAddress);

    // Check if stake is active
    if (!stakeInfo.isActive) {
      throw new ForbiddenException(
        'Your stake is not active. Please activate your stake to submit signals.',
      );
    }

    // Check if stake is still locked
    const currentTimestamp = Math.floor(Date.now() / 1000);
    if (stakeInfo.lockedUntil > currentTimestamp) {
      const unlockDate = new Date(stakeInfo.lockedUntil * 1000);
      throw new ForbiddenException(
        `Your stake is locked until ${unlockDate.toISOString()}`,
      );
    }

    // Check minimum stake requirement
    const stakeAmount = BigInt(stakeInfo.amount);
    if (stakeAmount < this.minimumStake) {
      const requiredXLM = Number(this.minimumStake) / 10_000_000;
      const currentXLM = Number(stakeAmount) / 10_000_000;

      throw new ForbiddenException(
        `Insufficient stake. Required: ${requiredXLM} XLM, Current: ${currentXLM} XLM`,
      );
    }

    this.logger.log(
      `Stake validation passed for ${providerAddress}: ${Number(stakeAmount) / 10_000_000} XLM`,
    );

    return stakeInfo;
  }

  /**
   * Calculates confidence score based on stake amount
   * Higher stake = higher base confidence
   */
  calculateStakeConfidence(stakeInfo: StakeInfo): number {
    const stakeAmount = BigInt(stakeInfo.amount);
    const stakeRatio = Number(stakeAmount) / Number(this.minimumStake);

    // Base confidence from stake (0-30 points)
    // 1x minimum = 15 points
    // 2x minimum = 22 points
    // 5x+ minimum = 30 points
    let confidence = 15;

    if (stakeRatio >= 5) {
      confidence = 30;
    } else if (stakeRatio >= 2) {
      confidence = 22;
    } else if (stakeRatio >= 1.5) {
      confidence = 18;
    }

    return confidence;
  }
}