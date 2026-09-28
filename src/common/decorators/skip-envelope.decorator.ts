import { SetMetadata } from '@nestjs/common';

export const SKIP_ENVELOPE_KEY = 'skipEnvelope';

/**
 * Opt a controller class or route handler out of the global ResponseEnvelopeInterceptor.
 * Use for file-download endpoints, SSE streams, or responses that are already shaped.
 */
export const SkipEnvelope = () => SetMetadata(SKIP_ENVELOPE_KEY, true);
