import {
  Injectable,
  CanActivate,
  ExecutionContext,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as StellarSdk from '@stellar/stellar-sdk';
import { XDR_OPERATION_TYPE_KEY } from '../decorators/validate-xdr-operation-type.decorator';

@Injectable()
export class XdrOperationTypeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const expectedOperationType = this.reflector.get<string>(
      XDR_OPERATION_TYPE_KEY,
      context.getHandler(),
    );

    if (!expectedOperationType) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const transactionXdr = request.body?.transactionXdr;

    if (!transactionXdr) {
      throw new BadRequestException('transactionXdr is required');
    }

    this.validateXdrOperationType(transactionXdr, expectedOperationType);
    return true;
  }

  private validateXdrOperationType(
    transactionXdr: string,
    expectedOperationType: string,
  ): void {
    let txEnvelope: StellarSdk.TransactionBuilder.TransactionBuilderOptions;
    try {
      txEnvelope = StellarSdk.TransactionBuilder.fromXDR(
        transactionXdr,
        StellarSdk.Networks.PUBLIC,
      );
    } catch {
      throw new BadRequestException('Invalid transaction XDR format');
    }

    if (!txEnvelope || !Array.isArray(txEnvelope)) {
      throw new BadRequestException('Failed to decode transaction operations');
    }

    const transaction = new StellarSdk.Transaction(
      transactionXdr,
      StellarSdk.Networks.PUBLIC,
    );

    if (!transaction.operations || transaction.operations.length === 0) {
      throw new BadRequestException('Transaction contains no operations');
    }

    const actualOperationTypes = transaction.operations.map((op) => op.type);
    const mismatches = actualOperationTypes.filter(
      (type) => type !== expectedOperationType,
    );

    if (mismatches.length > 0) {
      throw new BadRequestException(
        `Transaction contains unexpected operation type(s). Expected: ${expectedOperationType}, ` +
          `but found: ${actualOperationTypes.join(', ')}`,
      );
    }
  }
}
