import { SetMetadata } from '@nestjs/common';

export enum WalletNetworkRequirement {
  TESTNET = 'testnet',
  MAINNET = 'mainnet',
  EITHER = 'either',
}

export const WALLET_NETWORK_REQUIREMENT_KEY = 'walletNetworkRequirement';

/**
 * Decorator to specify the required Stellar network (testnet/mainnet/either) for an endpoint.
 * Must be used on controller methods. The wallet's network will be validated by
 * WalletNetworkGuard which should be registered globally or on the controller.
 *
 * @example
 * @Get('price')
 * @WalletNetworkRequirement(WalletNetworkRequirement.MAINNET)
 * getPrice(@CurrentWallet() wallet: string) { ... }
 */
export function WalletNetworkRequirement(
  requirement: WalletNetworkRequirement,
) {
  return SetMetadata(WALLET_NETWORK_REQUIREMENT_KEY, requirement);
}
