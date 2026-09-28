import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AbiManagementService } from './abi-management.service';
import { ContractAbi } from './entities/contract-abi.entity';
import { Repository } from 'typeorm';

function makeRepo(records: ContractAbi[] = []): jest.Mocked<Repository<ContractAbi>> {
  return {
    create: jest.fn((dto) => dto as ContractAbi),
    save: jest.fn(async (value) => ({ id: 'saved-id', createdAt: new Date(), updatedAt: new Date(), ...value } as ContractAbi)),
    findOne: jest.fn().mockImplementation(async (query) => {
      if ('version' in (query.where ?? {})) {
        return records.find(
          (record) =>
            record.contractName === query.where.contractName &&
            record.network === query.where.network &&
            record.version === query.where.version,
        ) ?? null;
      }

      return (
        [...records].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null
      );
    }),
    find: jest.fn().mockResolvedValue(records),
  } as unknown as jest.Mocked<Repository<ContractAbi>>;
}

describe('AbiManagementService', () => {
  it('uploads and versions a valid ABI', async () => {
    const repo = makeRepo([]);
    const service = new AbiManagementService(repo);

    const result = await service.uploadAbi({
      contractName: 'TokenBridge',
      network: 'mainnet',
      abi: [{ type: 'function', name: 'mint', inputs: [] }],
      metadata: { address: 'GABC' },
    });

    expect(result.contractName).toBe('TokenBridge');
    expect(result.version).toBe('1.0.0');
    expect(repo.save).toHaveBeenCalled();
  });

  it('rejects malformed ABI payloads', async () => {
    const service = new AbiManagementService(makeRepo([]));

    await expect(
      service.uploadAbi({
        contractName: 'TokenBridge',
        network: 'mainnet',
        abi: { not: 'an array' },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('retrieves ABI versions by contract and network', async () => {
    const records = [
      {
        contractName: 'TokenBridge',
        network: 'mainnet',
        version: '1.0.0',
        abi: [{ type: 'function', name: 'mint' }],
        abiHash: 'hash-1',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
      {
        contractName: 'TokenBridge',
        network: 'mainnet',
        version: '1.0.1',
        abi: [{ type: 'function', name: 'burn' }],
        abiHash: 'hash-2',
        createdAt: new Date('2026-02-01T00:00:00.000Z'),
        updatedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    ] as ContractAbi[];
    const service = new AbiManagementService(makeRepo(records));

    const latest = await service.getLatestAbi('TokenBridge', 'mainnet');
    const version = await service.getAbiVersion('TokenBridge', 'mainnet', '1.0.0');
    const versions = await service.listAbiVersions('TokenBridge', 'mainnet');

    expect(latest.version).toBe('1.0.1');
    expect(version.version).toBe('1.0.0');
    expect(versions).toHaveLength(2);
  });

  it('throws when a version is missing', async () => {
    const service = new AbiManagementService(makeRepo([]));

    await expect(service.getAbiVersion('Missing', 'mainnet', '1.0.0')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
