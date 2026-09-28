import { HttpException, HttpStatus } from '@nestjs/common';
import { WalletNetworkRequirement } from '../decorators/wallet-network-requirement.decorator';

export class WalletNetworkMismatchException extends HttpException {
  constructor(
    requiredNetwork: WalletNetworkRequirement,
    walletNetwork?: WalletNetworkRequirement | string,
  ) {
    super(
      {
        message: `Wallet network mismatch. This endpoint requires ${requiredNetwork} network.`,
        error: 'WalletNetworkMismatch',
        requiredNetwork,
        walletNetwork,
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
