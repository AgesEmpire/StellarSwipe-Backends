import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  WALLET_NETWORK_REQUIREMENT_KEY,
  WalletNetworkRequirement,
} from '../decorators/wallet-network-requirement.decorator';
import { WalletNetworkDetectorService } from '../services/wallet-network-detector.service';
import { WalletNetworkMismatchException } from '../exceptions/wallet-network-mismatch.exception';

/**
 * Guard that validates wallet network matches endpoint requirement.
 * Uses @WalletNetworkRequirement decorator on controller methods.
 *
 * Should be registered globally or on specific controllers/methods.
 * Checks the requirement metadata and extracts wallet network from request.
 */
@Injectable()
export class WalletNetworkGuard implements CanActivate {
  private readonly logger = new Logger(WalletNetworkGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly networkDetector: WalletNetworkDetectorService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement = this.reflector.getAllAndOverride<
      WalletNetworkRequirement | undefined
    >(WALLET_NETWORK_REQUIREMENT_KEY, [context.getHandler(), context.getClass()]);

    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request?.user;

    const walletNetwork = this.networkDetector.extractNetworkFromUser(user);
    const isAllowed = this.networkDetector.isNetworkAllowed(
      walletNetwork,
      requirement,
    );

    if (!isAllowed) {
      this.logger.warn(
        `[WalletNetworkGuard] Network mismatch: wallet=${walletNetwork}, required=${requirement}`,
      );
      throw new WalletNetworkMismatchException(requirement, walletNetwork);
    }

    return true;
  }
}
