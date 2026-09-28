import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { ContractAbi, ContractAbiMetadata } from './entities/contract-abi.entity';
import { UploadAbiDto } from './dto/upload-abi.dto';
import { AbiVersionDto } from './dto/abi-version.dto';
import { canonicalizeAbi, parseAbiPayload, AbiEntry } from './utils/abi-validator';

export interface AbiUploadActor {
  id: string;
  roles?: string[];
}

@Injectable()
export class AbiManagementService {
  private readonly logger = new Logger(AbiManagementService.name);

  constructor(
    @InjectRepository(ContractAbi)
    private readonly abiRepository: Repository<ContractAbi>,
  ) {}

  async uploadAbi(
    dto: UploadAbiDto,
    actor?: AbiUploadActor,
  ): Promise<AbiVersionDto> {
    const abi = this.validateAbi(dto.abi);
    const version = dto.version ?? (await this.resolveNextVersion(dto.contractName, dto.network));
    const abiHash = this.hashAbi(abi);

    const entity = this.abiRepository.create({
      contractName: dto.contractName,
      network: dto.network,
      version,
      abi: abi as Record<string, unknown>[],
      abiHash,
      metadata: dto.metadata as ContractAbiMetadata | undefined,
      uploadedByUserId: actor?.id,
      isActive: true,
    });

    const saved = await this.abiRepository.save(entity);
    this.logger.log(
      `Stored ABI ${saved.contractName}@${saved.network} version ${saved.version}`,
    );
    return this.toDto(saved);
  }

  async getLatestAbi(contractName: string, network: string): Promise<AbiVersionDto> {
    const record = await this.abiRepository.findOne({
      where: { contractName, network },
      order: { createdAt: 'DESC' },
    });

    if (!record) {
      throw new NotFoundException(`No ABI found for ${contractName} on ${network}`);
    }

    return this.toDto(record);
  }

  async getAbiVersion(
    contractName: string,
    network: string,
    version: string,
  ): Promise<AbiVersionDto> {
    const record = await this.abiRepository.findOne({
      where: { contractName, network, version },
    });

    if (!record) {
      throw new NotFoundException(
        `ABI version ${version} not found for ${contractName} on ${network}`,
      );
    }

    return this.toDto(record);
  }

  async listAbiVersions(contractName: string, network: string): Promise<AbiVersionDto[]> {
    const records = await this.abiRepository.find({
      where: { contractName, network },
      order: { createdAt: 'DESC' },
    });

    return records.map((record) => this.toDto(record));
  }

  private validateAbi(abi: unknown): AbiEntry[] {
    try {
      return parseAbiPayload(abi);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private async resolveNextVersion(contractName: string, network: string): Promise<string> {
    const versions = await this.abiRepository.find({
      where: { contractName, network },
      order: { createdAt: 'DESC' },
    });

    if (versions.length === 0) {
      return '1.0.0';
    }

    const [major, minor, patch] = versions[0].version.split('.').map((part) => Number(part) || 0);
    return `${major}.${minor}.${patch + 1}`;
  }

  private hashAbi(abi: AbiEntry[]): string {
    return crypto.createHash('sha256').update(canonicalizeAbi(abi)).digest('hex');
  }

  private toDto(record: ContractAbi): AbiVersionDto {
    return {
      contractName: record.contractName,
      network: record.network,
      version: record.version,
      abiHash: record.abiHash,
      createdAt: record.createdAt.toISOString(),
      metadata: record.metadata as Record<string, unknown> | undefined,
    };
  }
}
