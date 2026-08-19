export class ErrorResponseDto {
  statusCode: number;
  errorCode: string;
  message: string | string[];
  path: string;
  timestamp: string;
  requestId?: string;
  details?: Record<string, unknown>;
}
