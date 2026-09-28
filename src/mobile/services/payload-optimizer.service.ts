import { Injectable } from '@nestjs/common';
import { compressPayload } from '../utils/delta-calculator';

@Injectable()
export class PayloadOptimizerService {
  /**
   * Strips null/undefined fields and applies field aliasing for compact mobile payloads.
   */
  optimize<T extends Record<string, unknown>>(data: T): Partial<T> {
    return compressPayload(data);
  }

  optimizeArray<T extends Record<string, unknown>>(items: T[]): Partial<T>[] {
    return items.map((item) => this.optimize(item));
  }
}
