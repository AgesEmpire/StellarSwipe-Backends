import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { successEnvelope, SuccessResponseEnvelope } from './response-envelope';

@Injectable()
export class ResponseEnvelopeInterceptor<T>
  implements NestInterceptor<T, SuccessResponseEnvelope<T>>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessResponseEnvelope<T>> {
    return next.handle().pipe(map((data) => successEnvelope(data)));
  }
}
