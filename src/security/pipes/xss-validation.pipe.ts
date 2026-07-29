import { PipeTransform, Injectable, BadRequestException, ArgumentMetadata } from '@nestjs/common';
import DOMPurify from 'isomorphic-dompurify';

/**
 * XssValidationPipe — rejects requests containing XSS payloads.
 *
 * Unlike SanitizationPipe (which silently strips HTML), this pipe throws
 * a 400 BadRequestException when a string value contains HTML/script tags
 * after DOMPurify processing, making XSS attempts visible in logs.
 *
 * Apply at the controller or handler level for sensitive inputs:
 *   @UsePipes(XssValidationPipe)
 */
@Injectable()
export class XssValidationPipe implements PipeTransform {
  transform(value: any, _metadata: ArgumentMetadata) {
    this.validate(value, '');
    return value;
  }

  private validate(value: any, path: string): void {
    if (typeof value === 'string') {
      const clean = DOMPurify.sanitize(value, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
      if (clean !== value) {
        throw new BadRequestException(
          `Input at '${path || 'body'}' contains disallowed HTML or script content`,
        );
      }
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item, i) => this.validate(item, `${path}[${i}]`));
      return;
    }

    if (value && typeof value === 'object') {
      for (const [key, val] of Object.entries(value)) {
        this.validate(val, path ? `${path}.${key}` : key);
      }
    }
  }
}
