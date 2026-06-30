import { SetMetadata } from '@nestjs/common';

export const XDR_OPERATION_TYPE_KEY = 'xdr_operation_type';

export const ValidateXdrOperationType = (operationType: string) =>
  SetMetadata(XDR_OPERATION_TYPE_KEY, operationType);
