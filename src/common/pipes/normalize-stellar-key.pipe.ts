import { PipeTransform, Injectable } from '@nestjs/common';

@Injectable()
export class NormalizeStellarKeyPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string') return value;
    return value.trim().toUpperCase();
  }
}
