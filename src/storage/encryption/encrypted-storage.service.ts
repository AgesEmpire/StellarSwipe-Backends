import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EncryptionService } from '../../security/encryption.service';
import { EncryptedPayloadDto } from './dto/encrypted-payload.dto';
import {
  EncryptedPayloadAccessLevel,
  EncryptedPayloadRecord,
  EncryptedPayloadSourceType,
} from './entities/encrypted-payload.entity';
import {
  EncryptedStorageRequester,
  canBypassPayloadAccess,
  hashPayload,
  stableStringify,
} from './utils/crypto-helper';

export interface DecryptedEncryptedPayload {
  id: string;
  sourceType: EncryptedPayloadSourceType;
  accessLevel: EncryptedPayloadAccessLevel;
  tenantId?: string;
  ownerUserId?: string;
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  payloadHash: string;
  createdAt: string;
}

@Injectable()
export class EncryptedStorageService {
  private readonly logger = new Logger(EncryptedStorageService.name);

  constructor(
    @InjectRepository(EncryptedPayloadRecord)
    private readonly payloadRepository: Repository<EncryptedPayloadRecord>,
    private readonly encryptionService: EncryptionService,
  ) {}

  async storePayload(
    dto: EncryptedPayloadDto,
    requester: EncryptedStorageRequester,
  ): Promise<DecryptedEncryptedPayload> {
    this.assertCanStore(requester, dto);

    const payloadHash = hashPayload(dto.payload);
    const encryptedPayload = this.encryptionService.encrypt(stableStringify(dto.payload));

    const entity = this.payloadRepository.create({
      tenantId: dto.tenantId ?? requester.tenantId,
      ownerUserId: dto.ownerUserId ?? requester.id,
      sourceType: dto.sourceType,
      accessLevel: dto.accessLevel ?? EncryptedPayloadAccessLevel.PRIVATE,
      payloadHash,
      encryptedPayload,
      metadata: dto.metadata,
      payloadSize: Buffer.byteLength(stableStringify(dto.payload), 'utf8'),
    });

    const saved = await this.payloadRepository.save(entity);
    this.logger.log(`Stored encrypted ${saved.sourceType} payload ${saved.id}`);
    return this.toDecryptedDto(saved, dto.payload);
  }

  async getPayload(
    payloadId: string,
    requester: EncryptedStorageRequester,
  ): Promise<DecryptedEncryptedPayload> {
    const record = await this.payloadRepository.findOne({ where: { id: payloadId } });
    if (!record) {
      throw new NotFoundException(`Encrypted payload not found: ${payloadId}`);
    }

    this.assertCanAccess(record, requester);

    const payload = this.parsePayload(this.encryptionService.decrypt(record.encryptedPayload));
    return this.toDecryptedDto(record, payload);
  }

  async listPayloads(
    requester: EncryptedStorageRequester,
  ): Promise<Array<Pick<DecryptedEncryptedPayload, 'id' | 'sourceType' | 'accessLevel' | 'tenantId' | 'ownerUserId' | 'payloadHash' | 'createdAt'>>> {
    const records = await this.payloadRepository.find({
      order: { createdAt: 'DESC' },
    });

    return records
      .filter((record) => this.canSeeRecord(record, requester))
      .map((record) => ({
        id: record.id,
        sourceType: record.sourceType,
        accessLevel: record.accessLevel,
        tenantId: record.tenantId,
        ownerUserId: record.ownerUserId,
        payloadHash: record.payloadHash,
        createdAt: record.createdAt.toISOString(),
      }));
  }

  private assertCanStore(
    requester: EncryptedStorageRequester,
    dto: EncryptedPayloadDto,
  ): void {
    if (!requester?.id) {
      throw new ForbiddenException('Authenticated access is required');
    }

    if (
      dto.ownerUserId &&
      dto.ownerUserId !== requester.id &&
      !canBypassPayloadAccess(requester)
    ) {
      throw new ForbiddenException('Cannot store payload on behalf of another user');
    }
  }

  private assertCanAccess(
    record: EncryptedPayloadRecord,
    requester: EncryptedStorageRequester,
  ): void {
    if (canBypassPayloadAccess(requester)) {
      return;
    }

    if (record.ownerUserId && record.ownerUserId === requester.id) {
      return;
    }

    if (
      record.accessLevel === EncryptedPayloadAccessLevel.TENANT &&
      record.tenantId &&
      record.tenantId === requester.tenantId
    ) {
      return;
    }

    throw new ForbiddenException('You are not allowed to decrypt this payload');
  }

  private canSeeRecord(
    record: EncryptedPayloadRecord,
    requester: EncryptedStorageRequester,
  ): boolean {
    if (canBypassPayloadAccess(requester)) {
      return true;
    }

    if (record.ownerUserId && record.ownerUserId === requester.id) {
      return true;
    }

    return (
      record.accessLevel === EncryptedPayloadAccessLevel.TENANT &&
      !!record.tenantId &&
      record.tenantId === requester.tenantId
    );
  }

  private parsePayload(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Payload must be a JSON object');
      }
      return parsed as Record<string, unknown>;
    } catch (error) {
      throw new BadRequestException(
        `Failed to parse decrypted payload: ${(error as Error).message}`,
      );
    }
  }

  private toDecryptedDto(
    record: EncryptedPayloadRecord,
    payload: Record<string, unknown>,
  ): DecryptedEncryptedPayload {
    return {
      id: record.id,
      sourceType: record.sourceType,
      accessLevel: record.accessLevel,
      tenantId: record.tenantId,
      ownerUserId: record.ownerUserId,
      payload,
      metadata: record.metadata,
      payloadHash: record.payloadHash,
      createdAt: record.createdAt.toISOString(),
    };
  }
}
