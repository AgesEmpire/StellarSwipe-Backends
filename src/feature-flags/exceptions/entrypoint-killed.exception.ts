import { HttpException, HttpStatus } from '@nestjs/common';

export class EntrypointKilledException extends HttpException {
  constructor(contractId: string, method: string) {
    super(
      {
        message: `Entrypoint ${contractId}.${method} is temporarily disabled`,
        error: 'EntrypointKilled',
        contractId,
        method,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
