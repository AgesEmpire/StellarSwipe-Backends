import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

@Injectable()
export class PaginationInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const query = request.query;

    // Extract pagination parameters
    const page = parseInt(query.page) || 1;
    const limit = Math.min(parseInt(query.limit) || 20, 100); // Max 100 items per page

    return next.handle().pipe(
      map((data) => {
        // If data is already a paginated response, return as is
        if (data && typeof data === 'object' && 'pagination' in data) {
          return data;
        }

        // If data is an array, apply pagination
        if (Array.isArray(data)) {
          const total = data.length;
          const totalPages = Math.ceil(total / limit);
          const startIndex = (page - 1) * limit;
          const endIndex = startIndex + limit;
          const paginatedData = data.slice(startIndex, endIndex);

          return {
            data: paginatedData,
            pagination: {
              page,
              limit,
              total,
              totalPages,
              hasNext: page < totalPages,
              hasPrev: page > 1,
            },
          };
        }

        // For non-array responses, return as is
        return data;
      }),
    );
  }
}