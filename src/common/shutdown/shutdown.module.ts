import { Global, Module } from '@nestjs/common';
import { ShutdownService } from './shutdown.service';
import { ShutdownGuardMiddleware } from './shutdown-guard.middleware';

/**
 * Global module exposing graceful-shutdown state to the whole application
 * (#1058) — the SIGTERM/SIGINT handler in main.ts flips it, and
 * {@link ShutdownGuardMiddleware} reads it on every request.
 */
@Global()
@Module({
  providers: [ShutdownService, ShutdownGuardMiddleware],
  exports: [ShutdownService, ShutdownGuardMiddleware],
})
export class ShutdownModule {}
