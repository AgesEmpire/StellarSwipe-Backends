/**
 * Returns image URL with quality/size query params for mobile consumption.
 * Actual resizing is handled by the CDN/image service.
 */
export function mobileImageUrl(
  originalUrl: string,
  quality = 70,
  maxWidth = 400,
): string {
  if (!originalUrl) return originalUrl;
  const url = new URL(originalUrl);
  url.searchParams.set('q', String(quality));
  url.searchParams.set('w', String(maxWidth));
  return url.toString();
}
