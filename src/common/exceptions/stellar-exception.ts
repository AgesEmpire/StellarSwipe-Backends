import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Custom exception for Stellar blockchain errors
 * Use this when Stellar Horizon API calls fail or blockchain operations encounter errors
 */
export class StellarException extends HttpException {
  constructor(
    message: string,
    status: HttpStatus = HttpStatus.BAD_GATEWAY,
    public readonly stellarError?: any,
  ) {
    super(
      {
        message,
        error: 'StellarError',
        stellarError,
      },
      status,
    );
  }
}
