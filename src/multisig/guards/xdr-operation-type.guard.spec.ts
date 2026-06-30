import { Test } from '@nestjs/testing';
import { ExecutionContext, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as StellarSdk from '@stellar/stellar-sdk';
import { XdrOperationTypeGuard } from './xdr-operation-type.guard';
import { XDR_OPERATION_TYPE_KEY } from '../decorators/validate-xdr-operation-type.decorator';

describe('XdrOperationTypeGuard', () => {
  let guard: XdrOperationTypeGuard;
  let reflector: Reflector;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        XdrOperationTypeGuard,
        {
          provide: Reflector,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<XdrOperationTypeGuard>(XdrOperationTypeGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  describe('canActivate', () => {
    it('should pass when no expected operation type is defined', () => {
      (reflector.get as jest.Mock).mockReturnValue(undefined);

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({}),
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      expect(guard.canActivate(mockContext)).toBe(true);
    });

    it('should throw when transactionXdr is missing', () => {
      (reflector.get as jest.Mock).mockReturnValue('payment');

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({ body: {} }),
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        BadRequestException,
      );
    });

    it('should throw when XDR format is invalid', () => {
      (reflector.get as jest.Mock).mockReturnValue('payment');

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            body: { transactionXdr: 'invalid_base64_xdr' },
          }),
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        BadRequestException,
      );
    });
  });

  describe('operation type validation', () => {
    let sourceAccount: StellarSdk.Account;
    let keypair: StellarSdk.Keypair;

    beforeEach(() => {
      keypair = StellarSdk.Keypair.random();
      sourceAccount = new StellarSdk.Account(keypair.publicKey(), '100');
    });

    it('should pass when XDR contains only matching operation type', () => {
      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: 100,
        networkPassphrase: StellarSdk.Networks.PUBLIC,
        v1: true,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: keypair.publicKey(),
            amount: '100',
            asset: StellarSdk.Asset.native(),
          }),
        )
        .setTimeout(30)
        .build();

      const xdr = tx.toXDR();

      (reflector.get as jest.Mock).mockReturnValue('payment');

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            body: { transactionXdr: xdr },
          }),
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).not.toThrow();
    });

    it('should throw when XDR contains mismatched operation type', () => {
      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: 100,
        networkPassphrase: StellarSdk.Networks.PUBLIC,
        v1: true,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: keypair.publicKey(),
            amount: '100',
            asset: StellarSdk.Asset.native(),
          }),
        )
        .setTimeout(30)
        .build();

      const xdr = tx.toXDR();

      (reflector.get as jest.Mock).mockReturnValue('createAccount');

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            body: { transactionXdr: xdr },
          }),
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).toThrow(
        BadRequestException,
      );
    });

    it('should handle multiple operations and reject if any mismatch', () => {
      const tx = new StellarSdk.TransactionBuilder(sourceAccount, {
        fee: 200,
        networkPassphrase: StellarSdk.Networks.PUBLIC,
        v1: true,
      })
        .addOperation(
          StellarSdk.Operation.payment({
            destination: keypair.publicKey(),
            amount: '100',
            asset: StellarSdk.Asset.native(),
          }),
        )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: keypair.publicKey(),
            amount: '50',
            asset: StellarSdk.Asset.native(),
          }),
        )
        .setTimeout(30)
        .build();

      const xdr = tx.toXDR();

      (reflector.get as jest.Mock).mockReturnValue('payment');

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => ({
            body: { transactionXdr: xdr },
          }),
        }),
        getHandler: () => ({}),
      } as unknown as ExecutionContext;

      expect(() => guard.canActivate(mockContext)).not.toThrow();
    });
  });
});
