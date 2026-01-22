import { Injectable, Logger, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject } from '@nestjs/common';
import { Cache } from 'cache-manager';
import {
  SorobanRpc,
  Contract,
  Address,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk';
import { VerifyStakeDto, StakeVerificationResponse, VerificationStatusDto } from '../dto/verify-stake.dto';

// Assuming you have a Provider entity
// import { Provider } from '../entities/provider.entity';

const MINIMUM_STAKE = '1000'; // 1000 XLM
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
const CACHE_PREFIX = 'stake_verification:';

@Injectable()
export class StakeVerificationService {
  private readonly logger = new Logger(StakeVerificationService.name);
  private readonly sorobanServer: SorobanRpc.Server;
  private readonly stakeContractAddress: string;
  private readonly networkPassphrase: string;

  constructor(
    // @InjectRepository(Provider)
    // private readonly providerRepository: Repository<Provider>,
    private readonly configService: ConfigService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {
    const rpcUrl = this.configService.get<string>('SOROBAN_RPC_URL', 'https://soroban-testnet.stellar.org');
    this.sorobanServer = new SorobanRpc.Server(rpcUrl);
    this.stakeContractAddress = this.configService.get<string>('STAKE_CONTRACT_ADDRESS');
    this.networkPassphrase = this.configService.get<string>(
      'STELLAR_NETWORK_PASSPHRASE',
      'Test SDF Network ; September 2015',
    );

    if (!this.stakeContractAddress) {
      this.logger.warn('STAKE_CONTRACT_ADDRESS not configured');
    }
  }

  /**
   * Verify provider's stake and grant verification badge
   */
  async verifyProviderStake(dto: VerifyStakeDto): Promise<StakeVerificationResponse> {
    this.logger.log(`Starting stake verification for provider: ${dto.publicKey}`);

    try {
      // Check cache first
      const cachedStatus = await this.getCachedVerificationStatus(dto.publicKey);
      if (cachedStatus && cachedStatus.isVerified) {
        this.logger.log(`Using cached verification status for ${dto.publicKey}`);
        return {
          verified: true,
          stakeAmount: cachedStatus.stakeAmount,
          minimumRequired: MINIMUM_STAKE,
          verifiedAt: cachedStatus.lastChecked,
          message: 'Provider is verified (cached)',
        };
      }

      // Query Soroban for actual stake amount
      const stakeAmount = await this.queryStakeFromSoroban(dto.publicKey);
      const stakeAmountNum = parseFloat(stakeAmount);
      const minimumStakeNum = parseFloat(MINIMUM_STAKE);

      const isVerified = stakeAmountNum >= minimumStakeNum;

      // Update provider verification status in database
      // Uncomment when Provider entity is available
      /*
      await this.updateProviderVerification(dto.publicKey, isVerified, stakeAmount);
      */

      // Cache the verification status
      if (isVerified) {
        await this.cacheVerificationStatus(dto.publicKey, stakeAmount);
      }

      const response: StakeVerificationResponse = {
        verified: isVerified,
        stakeAmount,
        minimumRequired: MINIMUM_STAKE,
        verifiedAt: isVerified ? new Date() : undefined,
        message: isVerified
          ? 'Verification successful! Badge granted.'
          : `Insufficient stake. Current: ${stakeAmount} XLM, Required: ${MINIMUM_STAKE} XLM`,
      };

      this.logger.log(`Verification result for ${dto.publicKey}: ${isVerified ? 'SUCCESS' : 'FAILED'}`);
      return response;
    } catch (error) {
      this.logger.error(`Stake verification failed for ${dto.publicKey}:`, error.stack);
      throw new InternalServerErrorException('Failed to verify stake. Please try again later.');
    }
  }

  /**
   * Query stake amount from Soroban smart contract
   */
  private async queryStakeFromSoroban(publicKey: string): Promise<string> {
    if (!this.stakeContractAddress) {
      throw new InternalServerErrorException('Stake contract not configured');
    }

    try {
      this.logger.debug(`Querying Soroban stake for ${publicKey}`);

      const contract = new Contract(this.stakeContractAddress);
      
      // Build the contract call
      // Assuming the contract has a method like: get_stake(address: Address) -> i128
      const addressScVal = new Address(publicKey).toScVal();
      
      const transaction = contract.call(
        'get_stake',
        addressScVal,
      );

      // Simulate the transaction to get the result
      const { result } = await this.sorobanServer.simulateTransaction(transaction as any);

      if (!result || SorobanRpc.Api.isSimulationError(result)) {
        this.logger.error('Soroban simulation failed', result);
        throw new Error('Failed to simulate stake query');
      }

      // Extract the stake amount from the result
      const stakeValue = scValToNative(result.retval);
      
      // Convert from stroops to XLM (1 XLM = 10^7 stroops)
      const stakeInXlm = (Number(stakeValue) / 10_000_000).toString();

      this.logger.debug(`Stake amount for ${publicKey}: ${stakeInXlm} XLM`);
      return stakeInXlm;
    } catch (error) {
      this.logger.error(`Soroban query failed for ${publicKey}:`, error.stack);
      
      // If Soroban call fails, return 0 instead of throwing
      // This prevents verification failure due to network issues
      if (error.message?.includes('not found') || error.message?.includes('does not exist')) {
        this.logger.warn(`No stake found for ${publicKey}`);
        return '0';
      }
      
      throw new InternalServerErrorException('Failed to query stake from Soroban contract');
    }
  }

  /**
   * Get verification status for a provider
   */
  async getVerificationStatus(publicKey: string): Promise<VerificationStatusDto> {
    // Try cache first
    const cached = await this.getCachedVerificationStatus(publicKey);
    if (cached) {
      return cached;
    }

    // Query from database
    // Uncomment when Provider entity is available
    /*
    const provider = await this.providerRepository.findOne({
      where: { publicKey },
    });

    if (!provider) {
      throw new BadRequestException('Provider not found');
    }

    return {
      isVerified: provider.verified || false,
      stakeAmount: provider.stakeAmount || '0',
      lastChecked: provider.verificationCheckedAt || new Date(),
    };
    */

    // Fallback: query Soroban directly
    const stakeAmount = await this.queryStakeFromSoroban(publicKey);
    const isVerified = parseFloat(stakeAmount) >= parseFloat(MINIMUM_STAKE);

    return {
      isVerified,
      stakeAmount,
      lastChecked: new Date(),
    };
  }

  /**
   * Update provider verification status in database
   */
  private async updateProviderVerification(
    publicKey: string,
    verified: boolean,
    stakeAmount: string,
  ): Promise<void> {
    // Uncomment when Provider entity is available
    /*
    const provider = await this.providerRepository.findOne({
      where: { publicKey },
    });

    if (!provider) {
      throw new BadRequestException('Provider not found');
    }

    provider.verified = verified;
    provider.stakeAmount = stakeAmount;
    provider.verificationCheckedAt = new Date();

    if (verified && !provider.verifiedAt) {
      provider.verifiedAt = new Date();
    } else if (!verified) {
      provider.verifiedAt = null;
    }

    await this.providerRepository.save(provider);
    this.logger.log(`Updated verification status for ${publicKey}: verified=${verified}`);
    */
    
    this.logger.log(`Would update verification status for ${publicKey}: verified=${verified}`);
  }

  /**
   * Bulk verify multiple providers (used by monitoring job)
   */
  async bulkVerifyProviders(publicKeys: string[]): Promise<Map<string, boolean>> {
    this.logger.log(`Bulk verifying ${publicKeys.length} providers`);
    const results = new Map<string, boolean>();

    for (const publicKey of publicKeys) {
      try {
        const stakeAmount = await this.queryStakeFromSoroban(publicKey);
        const isVerified = parseFloat(stakeAmount) >= parseFloat(MINIMUM_STAKE);
        
        // Update database
        await this.updateProviderVerification(publicKey, isVerified, stakeAmount);
        
        // Update cache
        if (isVerified) {
          await this.cacheVerificationStatus(publicKey, stakeAmount);
        } else {
          await this.clearVerificationCache(publicKey);
        }

        results.set(publicKey, isVerified);
      } catch (error) {
        this.logger.error(`Failed to verify ${publicKey}:`, error.message);
        results.set(publicKey, false);
      }
    }

    return results;
  }

  /**
   * Cache verification status
   */
  private async cacheVerificationStatus(publicKey: string, stakeAmount: string): Promise<void> {
    const cacheKey = `${CACHE_PREFIX}${publicKey}`;
    const data: VerificationStatusDto = {
      isVerified: true,
      stakeAmount,
      lastChecked: new Date(),
      expiresAt: new Date(Date.now() + CACHE_TTL),
    };

    await this.cacheManager.set(cacheKey, data, CACHE_TTL);
    this.logger.debug(`Cached verification status for ${publicKey}`);
  }

  /**
   * Get cached verification status
   */
  private async getCachedVerificationStatus(publicKey: string): Promise<VerificationStatusDto | null> {
    const cacheKey = `${CACHE_PREFIX}${publicKey}`;
    const cached = await this.cacheManager.get<VerificationStatusDto>(cacheKey);
    
    if (cached && cached.expiresAt && new Date() < new Date(cached.expiresAt)) {
      return cached;
    }
    
    return null;
  }

  /**
   * Clear verification cache for a provider
   */
  private async clearVerificationCache(publicKey: string): Promise<void> {
    const cacheKey = `${CACHE_PREFIX}${publicKey}`;
    await this.cacheManager.del(cacheKey);
    this.logger.debug(`Cleared verification cache for ${publicKey}`);
  }

  /**
   * Revoke verification for a provider
   */
  async revokeVerification(publicKey: string): Promise<void> {
    this.logger.log(`Revoking verification for ${publicKey}`);
    
    await this.updateProviderVerification(publicKey, false, '0');
    await this.clearVerificationCache(publicKey);
  }
}