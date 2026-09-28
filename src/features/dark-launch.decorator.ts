import { SetMetadata } from '@nestjs/common';

export const DARK_LAUNCH_KEY = 'darkLaunch';

/**
 * Mark a controller method as dark-launched.
 *
 * @example
 * ```ts
 * @Get('new-endpoint')
 * @DarkLaunch('new-payment-flow')
 * async newPaymentFlow() { ... }
 * ```
 */
export const DarkLaunch = (feature: string) => SetMetadata(DARK_LAUNCH_KEY, feature);
