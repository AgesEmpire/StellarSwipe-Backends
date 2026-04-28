import { Response } from 'express';
import { VersionMetadata } from '../interfaces/version-config.interface';

/**
 * Utility to apply deprecation headers to a response.
 */
export function applyDeprecationHeaders(res: Response, metadata: VersionMetadata) {
  res.setHeader('Deprecation', 'true');
  
  if (metadata.sunsetDate) {
    res.setHeader('Sunset', metadata.sunsetDate);
  }
  
  if (metadata.successorVersion) {
    const successorUrl = `/api/v${metadata.successorVersion}`;
    res.setHeader('Link', `<${successorUrl}>; rel="successor-version"`);
  }
}

/**
 * Generate a deprecation warning message.
 */
export function getDeprecationWarning(version: string, metadata: VersionMetadata): string {
  let message = `API Version ${version} is deprecated.`;
  if (metadata.sunsetDate) {
    message += ` It will be sunset on ${metadata.sunsetDate}.`;
  }
  if (metadata.successorVersion) {
    message += ` Please migrate to v${metadata.successorVersion}.`;
  }
  return message;
}
