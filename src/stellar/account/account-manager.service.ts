import { Injectable, Logger } from '@nestjs/common';
import { Server, Account, Asset, Operation, TransactionBuilder, Networks } from 'stellar-sdk';
import { StellarConfigService } from '../../config/stellar.service';
import { ReserveCalculatorService } from './reserve-calculator.service';

export interface AccountInfo {
  accountId: string;
  balances: Array<{
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
    balance: string;
    limit?: string;
  }>;
  subentryCount: number;
  sequence: string;
}

export interface TrustlineInfo {
  asset: Asset;
  balance: string;
  limit: string;
  authorized: boolean;
}

@Injectable()
export class AccountManagerService {
  private readonly logger = new Logger(AccountManagerService.name);
  private server: Server;

  constructor(
    private stellarConfig: StellarConfigService,
    private reserveCalculator: ReserveCalculatorService,
  ) {
    this.server = new Server(this.stellarConfig.horizonUrl);
  }

  async getAccountInfo(publicKey: string): Promise<AccountInfo> {
    try {
      const account = await this.server.loadAccount(publicKey);
      
      return {
        accountId: account.accountId(),
        balances: account.balances,
        subentryCount: account.subentryCount,
        sequence: account.sequence,
      };
    } catch (error) {
      this.logger.error(`Failed to load account ${publicKey}:`, error);
      throw new Error(`Account not found or network error: ${error.message}`);
    }
  }

  async getTrustlines(publicKey: string): Promise<TrustlineInfo[]> {
    const accountInfo = await this.getAccountInfo(publicKey);
    
    return accountInfo.balances
      .filter(balance => balance.asset_type !== 'native')
      .map(balance => ({
        asset: new Asset(balance.asset_code!, balance.asset_issuer!),
        balance: balance.balance,
        limit: balance.limit || '0',
        authorized: true, // Simplified - would need to check issuer flags
      }));
  }

  async hasTrustline(publicKey: string, asset: Asset): Promise<boolean> {
    try {
      const trustlines = await this.getTrustlines(publicKey);
      return trustlines.some(tl => 
        tl.asset.getCode() === asset.getCode() && 
        tl.asset.getIssuer() === asset.getIssuer()
      );
    } catch (error) {
      this.logger.error(`Error checking trustline for ${publicKey}:`, error);
      return false;
    }
  }

  async canCreateTrustline(publicKey: string): Promise<{ canCreate: boolean; reason?: string }> {
    try {
      const accountInfo = await this.getAccountInfo(publicKey);
      const xlmBalance = accountInfo.balances.find(b => b.asset_type === 'native')?.balance || '0';
      
      // Check if account has sufficient XLM for reserve
      if (!this.reserveCalculator.canCreateTrustline(xlmBalance, accountInfo.subentryCount)) {
        return {
          canCreate: false,
          reason: `Insufficient XLM balance. Need ${this.reserveCalculator.calculateMinimumBalance(accountInfo.subentryCount + 1)} XLM minimum.`
        };
      }

      // Check subentry limit
      if (accountInfo.subentryCount >= this.reserveCalculator.getMaxSubentries()) {
        return {
          canCreate: false,
          reason: 'Account has reached maximum number of trustlines (1000)'
        };
      }

      return { canCreate: true };
    } catch (error) {
      this.logger.error(`Error checking trustline creation capability:`, error);
      return { canCreate: false, reason: 'Unable to verify account status' };
    }
  }

  async validateAssetForTrustline(asset: Asset): Promise<{ valid: boolean; reason?: string }> {
    if (asset.isNative()) {
      return { valid: false, reason: 'Cannot create trustline for native XLM' };
    }

    if (!asset.getCode() || !asset.getIssuer()) {
      return { valid: false, reason: 'Asset must have valid code and issuer' };
    }

    try {
      // Check if issuer account exists
      await this.server.loadAccount(asset.getIssuer()!);
      return { valid: true };
    } catch (error) {
      return { valid: false, reason: 'Asset issuer account does not exist' };
    }
  }

  buildChangeTrustOperation(asset: Asset, limit?: string): Operation {
    return Operation.changeTrust({
      asset,
      limit: limit || undefined,
    });
  }

  buildRemoveTrustlineOperation(asset: Asset): Operation {
    return Operation.changeTrust({
      asset,
      limit: '0',
    });
  }
}