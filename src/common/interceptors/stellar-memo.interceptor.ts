import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Reflector } from '@nestjs/core';
import { Response } from 'express';
import { STELLAR_MEMO_FIELD_KEY } from '../decorators/stellar-memo.decorator';

export interface DecodedMemo {
  type: 'none' | 'text' | 'id' | 'hash' | 'return';
  value: string | number | null;
}

@Injectable()
export class StellarMemoInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const isStellarMemoEnabled = this.reflector.get<boolean>(
      STELLAR_MEMO_FIELD_KEY,
      context.getHandler(),
    );

    if (!isStellarMemoEnabled) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        if (!data || typeof data !== 'object') {
          return data;
        }

        return this.decodeMemoFields(data);
      }),
    );
  }

  private decodeMemoFields(data: any): any {
    if (Array.isArray(data)) {
      return data.map((item) => this.processMemoInObject(item));
    }

    return this.processMemoInObject(data);
  }

  private processMemoInObject(obj: any): any {
    if (!obj || typeof obj !== 'object') {
      return obj;
    }

    const processed = { ...obj };

    for (const [key, value] of Object.entries(processed)) {
      if (key === 'memo' && value !== null && value !== undefined) {
        processed[key] = this.decodeMemo(value);
      } else if (typeof value === 'object' && value !== null) {
        processed[key] = this.processMemoInObject(value);
      }
    }

    return processed;
  }

  private decodeMemo(memoValue: any): DecodedMemo {
    if (typeof memoValue === 'string') {
      return this.decodeMemoFromString(memoValue);
    }

    if (typeof memoValue === 'object' && memoValue !== null) {
      // Already decoded format
      if (memoValue.type && memoValue.value !== undefined) {
        return memoValue as DecodedMemo;
      }

      // Raw Stellar memo object format
      if (memoValue._arm_type !== undefined) {
        return this.decodeStellarMemoObject(memoValue);
      }
    }

    return {
      type: 'none',
      value: null,
    };
  }

  private decodeMemoFromString(memoString: string): DecodedMemo {
    try {
      // Try to parse as JSON first (in case it's encoded format)
      const parsed = JSON.parse(memoString);
      if (parsed.type && parsed.value !== undefined) {
        return parsed as DecodedMemo;
      }
    } catch {
      // If not JSON, treat as text memo
    }

    // Treat as base64-encoded text or raw text
    try {
      // Try base64 decode
      const decoded = Buffer.from(memoString, 'base64').toString('utf-8');
      return {
        type: 'text',
        value: decoded,
      };
    } catch {
      // If base64 fails, treat as raw text
      return {
        type: 'text',
        value: memoString,
      };
    }
  }

  private decodeStellarMemoObject(memoObj: any): DecodedMemo {
    const armType = memoObj._arm_type || memoObj.type;

    switch (armType) {
      case 0:
      case 'MEMO_NONE':
      case 'none':
        return { type: 'none', value: null };

      case 1:
      case 'MEMO_TEXT':
      case 'text':
        return {
          type: 'text',
          value: memoObj.text || memoObj.value || '',
        };

      case 2:
      case 'MEMO_ID':
      case 'id':
        const idValue = memoObj.id || memoObj.value;
        return {
          type: 'id',
          value: typeof idValue === 'string' ? parseInt(idValue, 10) : idValue,
        };

      case 3:
      case 'MEMO_HASH':
      case 'hash':
        const hashValue = memoObj.hash || memoObj.value;
        return {
          type: 'hash',
          value: typeof hashValue === 'string'
            ? hashValue
            : Buffer.from(hashValue).toString('base64'),
        };

      case 4:
      case 'MEMO_RETURN':
      case 'return':
        const returnValue = memoObj.return || memoObj.value;
        return {
          type: 'return',
          value: typeof returnValue === 'string'
            ? returnValue
            : Buffer.from(returnValue).toString('base64'),
        };

      default:
        return {
          type: 'none',
          value: null,
        };
    }
  }
}
