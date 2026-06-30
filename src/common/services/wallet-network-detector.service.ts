import { Injectable, Logger } from '@nestjs/common';
import { StellarConfigService } from '../../config/stellar.service';
import { WalletNetworkRequirement } from '../decorators/wallet-network-requirement.decorator';

/**
 * Service to detect and validate wallet network affinity.
 *
 * The wallet's network is typically stored in the request context
 * via the JWT token or session data. This service maps that context
 * to the WalletNetworkRequirement enum.
 */
@Injectable()
export class WalletNetworkDetectorService {
  private readonly logger = new Logger(WalletNetworkDetectorService.name);

  constructor(private readonly stellarConfig: StellarConfigService) {}

  /**
   * Extract the network from the request user object.
   * Looks for network info in common property names.
   */
  extractNetworkFromUser(user: any): WalletNetworkRequirement | undefined {
    if (!user) return undefined;

    const network =
      user.network ||
      user.stellarNetwork ||
      user.walletNetwork ||
      user.stellar?.network;

    if (!network) return undefined;

    return this.normalizeNetwork(network);
  }

  /**
   * Normalize network string to WalletNetworkRequirement enum.
   */
  private normalizeNetwork(
    network: string,
  ): WalletNetworkRequirement | undefined {
    const normalized = network.toLowerCase().trim();

    if (
      normalized === 'testnet' ||
      normalized === 'test' ||
      normalized === 'test-net'
    ) {
      return WalletNetworkRequirement.TESTNET;
    }

    if (
      normalized === 'mainnet' ||
      normalized === 'main' ||
      normalized === 'main-net' ||
      normalized === 'public'
    ) {
      return WalletNetworkRequirement.MAINNET;
    }

    return undefined;
  }

  /**
   * Check if wallet network matches the endpoint requirement.
   */
  isNetworkAllowed(
    walletNetwork: WalletNetworkRequirement | undefined,
    requiredNetwork: WalletNetworkRequirement,
  ): boolean {
    if (requiredNetwork === WalletNetworkRequirement.EITHER) {
      return true;
    }

    if (!walletNetwork) {
      this.logger.warn(
        `[WalletNetwork] Could not detect wallet network; endpoint requires ${requiredNetwork}`,
      );
      return false;
    }

    return walletNetwork === requiredNetwork;
  }
}
