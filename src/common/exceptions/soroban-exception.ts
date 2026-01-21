import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Custom exception for Soroban smart contract errors
 * Use this when Soroban contract invocations fail
 */
export class SorobanException extends HttpException {
  constructor(
    message: string,
    public readonly contractId?: string,
    public readonly method?: string,
    public readonly sorobanError?: any,
  ) {
    super(
      {
        message,
        error: 'SorobanError',
        contractId,
        method,
        sorobanError,
      },
      HttpStatus.BAD_GATEWAY,
    );
  }
}
