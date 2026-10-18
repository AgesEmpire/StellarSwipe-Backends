import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';
import { assertUrlIsSsrfSafe, SsrfBlockedUrlError } from './ssrf-url-validator';

/**
 * Issue #1029 — SSRF protection for user-supplied webhook URLs.
 *
 * Enforces (see ssrf-url-validator.ts for the shared rule set):
 *  - Scheme: HTTPS only.
 *  - Port: 443 (explicit or implicit) only.
 *  - Hostname: blocked list (metadata endpoints by name).
 *  - IP addresses: all private, loopback, link-local, and cloud-metadata
 *    ranges are rejected, including post-DNS-resolution addresses to guard
 *    against DNS-rebinding.
 *
 * This pipe only validates the URL at registration time. #1377 — redirects
 * encountered at *delivery* time are revalidated hop-by-hop against the
 * same rules by sendWithValidatedRedirects (src/webhooks/services), since a
 * destination that was safe when registered can later issue a redirect
 * into a private network.
 */
@Injectable()
export class SsrfValidationPipe implements PipeTransform {
  async transform(url: string): Promise<string> {
    if (url === undefined || url === null) {
      return url;
    }

    try {
      await assertUrlIsSsrfSafe(url);
    } catch (err) {
      if (err instanceof SsrfBlockedUrlError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    return url;
  }
}
