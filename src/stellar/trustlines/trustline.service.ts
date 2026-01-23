import { Injectable, Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { Server, Asset, Keypair, TransactionBuilder, Networks, Operation } from 'stellar-sdk';
import { StellarConfigService } from '../../config/stellar.service';
import { AccountManagerService } from '../account/account-manager.service';
import { CreateTrustlineDto } from './dto/create-trustline.dto';
import { TrustlineStatusDto } from './dto/trustline-status.dto';

export interface TrustlineResult {
  success: boolean;
  transactionHash?: string;
  error?: string;
}

@Injectable()
export class TrustlineService {
  private readonly logger = new Logger(TrustlineService.name);
  private server: Server;

  constructor(
    private stellarConfig: StellarConfigService,
    private accountManager: AccountManagerService,
  ) {
    this.server = new Server(this.stellarConfig.horizonUrl);
  }

  async createTrustline(createTrustlineDto: CreateTrustlineDto): Promise<TrustlineResult> {
    const { publicKey, secretKey, assetCode, assetIssuer, limit } = createTrustlineDto;

    try {
      // Validate asset
      const asset = new Asset(assetCode, assetIssuer);
      const assetValidation = await this.accountManager.validateAssetForTrustline(asset);
      if (!assetValidation.valid) {
        throw new BadRequestException(assetValidation.reason);
      }

      // Check if trustline already exists
      const hasTrustline = await this.accountManager.hasTrustline(publicKey, asset);
      if (hasTrustline) {
        throw new ConflictException('Trustline already exists for this asset');
      }

      // Check if account can create trustline
      const canCreate = await this.accountManager.canCreateTrustline(publicKey);
      if (!canCreate.canCreate) {
        throw new BadRequestException(canCreate.reason);
      }

      // Build and submit transaction
      const account = await this.server.loadAccount(publicKey);
      const operation = this.accountManager.buildChangeTrustOperation(asset, limit);
      
      const transaction = new TransactionBuilder(account, {
        fee: '100000', // 0.01 XLM
        networkPassphrase: this.stellarConfig.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const keypair = Keypair.fromSecret(secretKey);
      transaction.sign(keypair);

      const result = await this.server.submitTransaction(transaction);
      
      this.logger.log(`Trustline created successfully: ${result.hash}`);
      return {
        success: true,
        transactionHash: result.hash,
      };

    } catch (error) {
      this.logger.error('Failed to create trustline:', error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
      };
    }
  }

  async removeTrustline(publicKey: string, secretKey: string, assetCode: string, assetIssuer: string): Promise<TrustlineResult> {
    try {
      const asset = new Asset(assetCode, assetIssuer);
      
      // Check if trustline exists
      const hasTrustline = await this.accountManager.hasTrustline(publicKey, asset);
      if (!hasTrustline) {
        throw new BadRequestException('Trustline does not exist for this asset');
      }

      // Check if balance is zero
      const trustlines = await this.accountManager.getTrustlines(publicKey);
      const targetTrustline = trustlines.find(tl => 
        tl.asset.getCode() === assetCode && tl.asset.getIssuer() === assetIssuer
      );

      if (targetTrustline && parseFloat(targetTrustline.balance) > 0) {
        throw new BadRequestException('Cannot remove trustline with non-zero balance');
      }

      // Build and submit transaction
      const account = await this.server.loadAccount(publicKey);
      const operation = this.accountManager.buildRemoveTrustlineOperation(asset);
      
      const transaction = new TransactionBuilder(account, {
        fee: '100000',
        networkPassphrase: this.stellarConfig.networkPassphrase,
      })
        .addOperation(operation)
        .setTimeout(30)
        .build();

      const keypair = Keypair.fromSecret(secretKey);
      transaction.sign(keypair);

      const result = await this.server.submitTransaction(transaction);
      
      this.logger.log(`Trustline removed successfully: ${result.hash}`);
      return {
        success: true,
        transactionHash: result.hash,
      };

    } catch (error) {
      this.logger.error('Failed to remove trustline:', error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
      };
    }
  }

  async getTrustlineStatus(publicKey: string): Promise<TrustlineStatusDto> {
    try {
      const accountInfo = await this.accountManager.getAccountInfo(publicKey);
      const trustlines = await this.accountManager.getTrustlines(publicKey);
      const xlmBalance = accountInfo.balances.find(b => b.asset_type === 'native')?.balance || '0';
      
      const canCreate = await this.accountManager.canCreateTrustline(publicKey);
      
      return {
        publicKey,
        trustlineCount: trustlines.length,
        maxTrustlines: 1000,
        canCreateMore: canCreate.canCreate,
        xlmBalance,
        reserveRequired: '0.5',
        trustlines: trustlines.map(tl => ({
          assetCode: tl.asset.getCode(),
          assetIssuer: tl.asset.getIssuer()!,
          balance: tl.balance,
          limit: tl.limit,
          authorized: tl.authorized,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to get trustline status:', error);
      throw new BadRequestException('Unable to retrieve trustline status');
    }
  }

  async checkTrustlineBeforeTrade(publicKey: string, asset: Asset): Promise<{ hasRequired: boolean; needsCreation: boolean }> {
    if (asset.isNative()) {
      return { hasRequired: true, needsCreation: false };
    }

    const hasTrustline = await this.accountManager.hasTrustline(publicKey, asset);
    
    if (hasTrustline) {
      return { hasRequired: true, needsCreation: false };
    }

    const canCreate = await this.accountManager.canCreateTrustline(publicKey);
    return { 
      hasRequired: false, 
      needsCreation: canCreate.canCreate 
    };
  }

  async autoCreateTrustlineForTrade(publicKey: string, secretKey: string, asset: Asset): Promise<TrustlineResult> {
    if (asset.isNative()) {
      return { success: true };
    }

    const check = await this.checkTrustlineBeforeTrade(publicKey, asset);
    
    if (check.hasRequired) {
      return { success: true };
    }

    if (!check.needsCreation) {
      return { 
        success: false, 
        error: 'Cannot create required trustline - insufficient reserves or at limit' 
      };
    }

    return this.createTrustline({
      publicKey,
      secretKey,
      assetCode: asset.getCode(),
      assetIssuer: asset.getIssuer()!,
    });
  }
}