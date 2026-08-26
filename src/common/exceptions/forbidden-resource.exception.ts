import { ForbiddenException } from '@nestjs/common';

/** Stable error code for any account-ownership authorization rejection, REST or GraphQL. */
export const FORBIDDEN_RESOURCE_ERROR_CODE = 'FORBIDDEN_RESOURCE';

/**
 * Thrown whenever a caller attempts to read or act on a resource that is
 * bound to another account and the caller is neither the owner nor an
 * authorized operator (e.g. an admin).
 *
 * Using a single exception type for every ownership check — REST guards,
 * GraphQL field guards, service-layer assertions — means every unauthorized
 * access attempt resolves to the *same* shape (HTTP 403, code
 * FORBIDDEN_RESOURCE) instead of ad-hoc messages scattered per resolver,
 * which also avoids leaking whether a resource exists at all vs. is merely
 * inaccessible.
 */
export class ForbiddenResourceException extends ForbiddenException {
  constructor(resource: string = 'resource') {
    super({
      statusCode: 403,
      error: 'Forbidden',
      code: FORBIDDEN_RESOURCE_ERROR_CODE,
      message: `You do not have permission to access this ${resource}.`,
    });
  }
}
