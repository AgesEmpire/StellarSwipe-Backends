import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Exception thrown when the calculated slippage exceeds the allowed tolerance.
 * Maps to HTTP 422 (Unprocessable Entity).
 */
export class SlippageExceededException extends UnprocessableEntityException {
  constructor(
    referencePrice: number,
    livePrice: number,
    deviationBps: number,
    allowedBps: number,
  ) {
    super({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: `Slippage tolerance exceeded. Deviation: ${Math.round(
        deviationBps,
      )} bps (Limit: ${allowedBps} bps)`,
      details: {
        referencePrice,
        livePrice,
        deviationBps: Math.round(deviationBps),
        allowedBps,
      },
    });
  }
}
