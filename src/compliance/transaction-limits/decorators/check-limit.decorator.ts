import { SetMetadata } from '@nestjs/common';
import { LimitScope } from '../entities/transaction-limit.entity';

export const LIMIT_SCOPE_KEY = 'limitScope';
export const CheckLimit = (scope: LimitScope) =>
  SetMetadata(LIMIT_SCOPE_KEY, scope);
