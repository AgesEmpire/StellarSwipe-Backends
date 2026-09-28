import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EncryptionService } from '../../security/encryption.service';
import { EncryptedStorageService } from './encrypted-storage.service';
import { EncryptedPayloadAccessLevel, EncryptedPayloadRecord, EncryptedPayloadSourceType } from './entities/encrypted-payload.entity';
import { Repository } from 'typeorm';

const VALID_KEY = 'a-sufficiently-long-encryption-key-for-tests!!';

function makeEncryptionService(): EncryptionService {
  const config = { get: jest.fn().mockReturnValue(VALID_KEY) } as unknown as ConfigService;
  return new EncryptionService(config);
}

function makeRepo(record?: EncryptedPayloadRecord): jest.Mocked<Repository<EncryptedPayloadRecord>> {
  return {
    create: jest.fn((value) => value as EncryptedPayloadRecord),
    save: jest.fn(async (value) => ({ id: 'payload-1', createdAt: new Date(), updatedAt: new Date(), ...value } as EncryptedPayloadRecord)),
    findOne: jest.fn().mockResolvedValue(record ?? null),
    find: jest.fn().mockResolvedValue(record ? [record] : []),
  } as unknown as jest.Mocked<Repository<EncryptedPayloadRecord>>;
}

describe('EncryptedStorageService', () => {
  it('encrypts payloads before persistence and decrypts on read', async () => {
    const encryptionService = makeEncryptionService();
    const repo = makeRepo({
      id: 'payload-1',
      ownerUserId: 'user-1',
      sourceType: EncryptedPayloadSourceType.WEBHOOK,
      accessLevel: EncryptedPayloadAccessLevel.PRIVATE,
      payloadHash: 'hash',
      encryptedPayload: encryptionService.encrypt(JSON.stringify({ secret: 'value' })),
      metadata: { hook: 'webhook-1' },
      payloadSize: 0,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    } as EncryptedPayloadRecord);
    const service = new EncryptedStorageService(repo, encryptionService);

    const stored = await service.storePayload(
      {
        sourceType: EncryptedPayloadSourceType.CALLBACK,
        payload: { hello: 'world' },
        metadata: { callbackId: 'cb-1' },
      },
      { id: 'user-1', roles: ['tenant-admin'] },
    );

    expect(stored.payload).toEqual({ hello: 'world' });
    expect(encryptionService.decrypt((repo.save.mock.calls[0][0] as EncryptedPayloadRecord).encryptedPayload)).toEqual(JSON.stringify({ hello: 'world' }));
  });

  it('denies retrieval to unauthorized users', async () => {
    const encryptionService = makeEncryptionService();
    const repo = makeRepo({
      id: 'payload-1',
      ownerUserId: 'owner-1',
      sourceType: EncryptedPayloadSourceType.WEBHOOK,
      accessLevel: EncryptedPayloadAccessLevel.PRIVATE,
      payloadHash: 'hash',
      encryptedPayload: encryptionService.encrypt(JSON.stringify({ secret: 'value' })),
      payloadSize: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as EncryptedPayloadRecord);
    const service = new EncryptedStorageService(repo, encryptionService);

    await expect(
      service.getPayload('payload-1', { id: 'intruder', roles: ['member'] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows admins to retrieve any decrypted payload', async () => {
    const encryptionService = makeEncryptionService();
    const repo = makeRepo({
      id: 'payload-1',
      ownerUserId: 'owner-1',
      sourceType: EncryptedPayloadSourceType.WEBHOOK,
      accessLevel: EncryptedPayloadAccessLevel.PRIVATE,
      payloadHash: 'hash',
      encryptedPayload: encryptionService.encrypt(JSON.stringify({ secret: 'value' })),
      payloadSize: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as EncryptedPayloadRecord);
    const service = new EncryptedStorageService(repo, encryptionService);

    const result = await service.getPayload('payload-1', { id: 'admin-1', roles: ['admin'] });

    expect(result.payload).toEqual({ secret: 'value' });
  });
});
