import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { SorobanException } from '../exceptions';
import { ErrorResponseDto } from '../dto/error-response.dto';
import { ErrorCode } from '../error-classification/error-codes.enum';

/**
 * Filter to translate Soroban RPC/contract failures into stable application errors.
 * Registered selectively for modules that invoke Soroban contracts.
 */
@Catch(SorobanException)
export class SorobanExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(SorobanExceptionFilter.name);

  catch(exception: SorobanException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const sorobanPayload = (exception as any).sorobanError;

    // Map known Soroban contract error payloads to stable codes/status
    const mapping = (payload: any): { code: ErrorCode; status: number; message: string } => {
      if (!payload) {
        return { code: ErrorCode.SOROBAN_RPC_ERROR, status: HttpStatus.BAD_GATEWAY, message: 'Soroban RPC failure' };
      }

      const code = payload.code || payload.error || (payload.result && payload.result.code) || '';

      // Recognize several common contract/RPC patterns and map them
      if (String(code).toLowerCase().includes('unauthorized') || String(code).toLowerCase().includes('forbidden')) {
        return { code: ErrorCode.SOROBAN_CONTRACT_ERROR, status: HttpStatus.FORBIDDEN, message: 'Contract authorization failed' };
      }
      if (String(code).toLowerCase().includes('invalid') || String(code).toLowerCase().includes('args')) {
        return { code: ErrorCode.SOROBAN_CONTRACT_ERROR, status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'Invalid contract arguments' };
      }
      if (String(code).toLowerCase().includes('rpc') || String(code).toLowerCase().includes('internal')) {
        return { code: ErrorCode.SOROBAN_RPC_ERROR, status: HttpStatus.BAD_GATEWAY, message: 'Soroban node error' };
      }

      // Fallback
      return { code: ErrorCode.SOROBAN_CONTRACT_ERROR, status: HttpStatus.BAD_GATEWAY, message: 'Smart contract execution failed' };
    };

    const mapped = mapping(sorobanPayload);

    // Build envelope without leaking raw RPC internals
    const body: ErrorResponseDto = {
      statusCode: mapped.status,
      errorCode: mapped.code,
      message: mapped.message,
      path: request.url,
      timestamp: new Date().toISOString(),
      requestId: request.headers['x-correlation-id'] as string || '',
    };

    this.logger.warn(`Soroban failure mapped to ${mapped.code} ${mapped.status} for ${request.url}`);

    response.status(mapped.status).json(body);
  }
}
