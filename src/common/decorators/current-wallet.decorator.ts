import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';

/**
 * Shape of the authenticated principal placed on the request by the
 * JWT/Passport pipeline. The wallet address may be exposed under a couple of
 * historically-inconsistent property names across the codebase, so we look at
 * all of them in priority order.
 */
interface RequestWithWallet {
  user?: {
    walletAddress?: string;
    publicKey?: string;
  } | null;
}

/**
 * Options for {@link CurrentWallet}.
 */
export interface CurrentWalletOptions {
  /**
   * When `true`, return `undefined` instead of throwing if no wallet is
   * present on the request. Defaults to `false` (strict — throws
   * {@link UnauthorizedException}).
   */
  optional?: boolean;
}

/**
 * Pulls the authenticated wallet address off the current HTTP request,
 * regardless of whether it was stored as `walletAddress` (REST JWT strategy)
 * or `publicKey` (wallet/session flows).
 */
function extractWallet(ctx: ExecutionContext): string | undefined {
  const request = ctx.switchToHttp().getRequest<RequestWithWallet>();
  const user = request?.user;
  const wallet = user?.walletAddress ?? user?.publicKey;
  return wallet && wallet.length > 0 ? wallet : undefined;
}

/**
 * Custom param decorator that extracts the authenticated wallet address from
 * the request in one place, replacing ad-hoc `request.user.walletAddress`
 * reads scattered across controllers.
 *
 * By default it throws a clear {@link UnauthorizedException} when no wallet is
 * present (e.g. the route was reached without a valid auth guard). Pass
 * `{ optional: true }` to receive `undefined` instead.
 *
 * @example
 * // Strict (default) — guaranteed non-empty string or 401:
 * @Post('refresh')
 * refresh(@CurrentWallet() wallet: string) { ... }
 *
 * @example
 * // Optional — returns `string | undefined`:
 * @Get('me')
 * me(@CurrentWallet({ optional: true }) wallet?: string) { ... }
 */
export function currentWalletFactory(
  options: CurrentWalletOptions | undefined,
  ctx: ExecutionContext,
): string | undefined {
  const wallet = extractWallet(ctx);

  if (!wallet && !options?.optional) {
    throw new UnauthorizedException(
      'No authenticated wallet found on the request',
    );
  }

  return wallet;
}

export const CurrentWallet = createParamDecorator(currentWalletFactory);
