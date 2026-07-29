import { Injectable, Logger } from '@nestjs/common';
import { Keypair } from '@stellar/stellar-sdk';
import { StellarConfigService } from '../config/stellar.service';
import { SessionManagerService } from '../auth/session/session-manager.service';

export interface WalletStatusResult {
  connected: boolean;
  walletAddress?: string;
  walletProvider?: string;
  network?: string;
  networkValid?: boolean;
  sessionActive?: boolean;
  guidance?: string;
}

@Injectable()
export class WalletStatusService {
  private readonly logger = new Logger(WalletStatusService.name);

  constructor(
    private readonly stellarConfig: StellarConfigService,
    private readonly sessionManager: SessionManagerService,
  ) {}

  async getStatus(
    sessionId: string | undefined,
    walletAddress: string | undefined,
    walletProvider: string | undefined,
  ): Promise<WalletStatusResult> {
    if (!walletAddress || !sessionId) {
      return {
        connected: false,
        guidance: 'No wallet connected. Please connect your Stellar wallet to continue.',
      };
    }

    const addressValid = this.isValidStellarAddress(walletAddress);
    if (!addressValid) {
      return {
        connected: false,
        guidance: 'The provided wallet address is not a valid Stellar public key.',
      };
    }

    const session = await this.sessionManager.getSession(sessionId);
    const sessionActive = !!session && session.publicKey === walletAddress;

    const networkValid = this.stellarConfig.network === 'testnet' || this.stellarConfig.network === 'mainnet' || this.stellarConfig.network === 'public';

    return {
      connected: sessionActive,
      walletAddress,
      walletProvider: walletProvider ?? 'unknown',
      network: this.stellarConfig.network,
      networkValid,
      sessionActive,
      guidance: sessionActive
        ? undefined
        : 'Session is inactive or wallet mismatch. Please reconnect.',
    };
  }

  async disconnect(sessionId: string): Promise<{ disconnected: boolean }> {
    await this.sessionManager.deleteSession(sessionId);
    this.logger.log(`Wallet session disconnected: ${sessionId}`);
    return { disconnected: true };
  }

  async refresh(
    sessionId: string,
    publicKey: string,
  ): Promise<WalletStatusResult> {
    await this.sessionManager.updateSessionActivity(sessionId);
    return this.getStatus(sessionId, publicKey, undefined);
  }

  private isValidStellarAddress(address: string): boolean {
    try {
      Keypair.fromPublicKey(address);
      return true;
    } catch {
      return false;
    }
  }
}
