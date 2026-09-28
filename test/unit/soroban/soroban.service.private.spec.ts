import { Test, TestingModule } from '@nestjs/testing';
import { SorobanService } from '../../../src/soroban/soroban.service';
import { StellarConfigService } from '../../../src/config/stellar.service';
import { SorobanDiagnosticService } from '../../../src/soroban/soroban-diagnostic.service';
import { SorobanRpcResilienceService } from '../../../src/soroban/soroban-rpc-resilience.service';
import { BASE_FEE } from '@stellar/stellar-sdk';

describe('SorobanService private helpers', () => {
  let service: SorobanService;

  const configMock = {
    sorobanRpcUrl: 'http://localhost',
    networkPassphrase: 'Test Passphrase',
    apiTimeout: 1000,
    maxCallDepth: 5,
    maxCallDepthViolationPolicy: 'reject',
  } as any;

  const diagMock = {
    parseDiagnosticEvents: jest.fn().mockReturnValue([]),
    logDiagnosticEvents: jest.fn(),
  } as any;

  const resilienceMock = { execute: jest.fn().mockImplementation((fn) => fn()) } as any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SorobanService,
        { provide: StellarConfigService, useValue: configMock },
        { provide: SorobanDiagnosticService, useValue: diagMock },
        { provide: SorobanRpcResilienceService, useValue: resilienceMock },
      ],
    }).compile();

    service = module.get<SorobanService>(SorobanService);
  });

  it('toBigInt converts string/number/bigint to BigInt', () => {
    expect((service as any).toBigInt('123')).toBe(BigInt(123));
    expect((service as any).toBigInt(456)).toBe(BigInt(456));
    expect((service as any).toBigInt(BigInt(7))).toBe(BigInt(7));
  });

  it('resolveInclusionFee picks p95 when present', () => {
    const feeStats = { sorobanInclusionFee: { p95: '100' } } as any;
    expect((service as any).resolveInclusionFee(feeStats)).toBe(BigInt(100));
  });

  it('resolveInclusionFee falls back to BASE_FEE when no candidate', () => {
    const feeStats = {} as any;
    expect((service as any).resolveInclusionFee(feeStats)).toBe((service as any).toBigInt(BASE_FEE));
  });

  it('parseScVal returns undefined for falsy and returns non-base64 strings unchanged', () => {
    expect((service as any).parseScVal(undefined)).toBeUndefined();
    expect((service as any).parseScVal('not-base64')).toBe('not-base64');
  });

  it('toScVal converts native values to ScVal instances', () => {
    const scVal = (service as any).toScVal(42);
    expect(scVal).toBeDefined();
    expect(scVal.constructor && scVal.constructor.name).toBeDefined();
  });
});
