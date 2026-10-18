import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { assertUrlIsSsrfSafe } from '../pipes/ssrf-url-validator';
import { WEBHOOK_MAX_REDIRECTS } from '../jobs/webhook-delivery.constants';

/**
 * Issue #1377 — Block private-network redirects in outbound webhook
 * fetches.
 *
 * SsrfValidationPipe only validates a webhook URL once, at registration
 * time. Left to axios's default redirect handling (`maxRedirects` > 0 via
 * the `follow-redirects` package), a destination that passed that check
 * could later return a 3xx pointing at `169.254.169.254`, `127.0.0.1`, or
 * any other private/internal address, and axios would connect straight to
 * it without this app ever getting a chance to validate it — the request
 * never surfaces at the HTTP layer where SsrfValidationPipe runs.
 *
 * This function closes that gap: it always sets `maxRedirects: 0` (so
 * axios/follow-redirects never auto-follows anything) and instead follows
 * the redirect chain itself, revalidating the resolved absolute URL of
 * *every* hop — including the first — against the exact same SSRF rules,
 * and bounding the chain to WEBHOOK_MAX_REDIRECTS hops so a malicious or
 * compromised endpoint can't redirect indefinitely either.
 */
export async function sendWithValidatedRedirects(
  config: AxiosRequestConfig & { url: string },
): Promise<AxiosResponse> {
  let currentUrl = config.url;
  let method = (config.method ?? 'get').toLowerCase();
  let data = config.data;
  let redirectCount = 0;

  for (;;) {
    // Validate the destination we are actually about to connect to on this
    // hop — not just the URL the caller originally passed in.
    await assertUrlIsSsrfSafe(currentUrl);

    try {
      return await axios.request({
        ...config,
        url: currentUrl,
        method,
        data,
        maxRedirects: 0,
      });
    } catch (err) {
      const axiosError = err as AxiosError;
      const status = axiosError.response?.status;
      const location = axiosError.response?.headers?.['location'];
      const isRedirect = typeof status === 'number' && status >= 300 && status < 400;

      if (!isRedirect || !location) {
        throw err;
      }

      redirectCount += 1;
      if (redirectCount > WEBHOOK_MAX_REDIRECTS) {
        throw new Error(
          `Webhook delivery aborted: exceeded ${WEBHOOK_MAX_REDIRECTS} redirects while fetching ${config.url}`,
        );
      }

      // The Location header may be relative — resolve it against the
      // current hop's URL before validating/following it.
      currentUrl = new URL(String(location), currentUrl).toString();

      // Mirror standard HTTP redirect semantics (the same ones
      // axios/follow-redirects apply automatically, which is the behavior
      // this function otherwise replaces): 303 always downgrades to GET;
      // 301/302 downgrade a POST to GET too. 307/308 preserve the original
      // method and body.
      if (status === 303 || ((status === 301 || status === 302) && method === 'post')) {
        method = 'get';
        data = undefined;
      }
    }
  }
}
