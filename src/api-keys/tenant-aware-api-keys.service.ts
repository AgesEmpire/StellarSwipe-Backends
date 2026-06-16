import { Injectable, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApiKey } from './entities/api-key.entity';
import { TenantContextProvider } from '../common/tenant-context';

/**
 * Tenant-aware API key operations
 */
@Injectable()
export class TenantAwareApiKeysService {
  constructor(
    @InjectRepository(ApiKey)
    private readonly apiKeyRepo: Repository<ApiKey>,
  ) {}

  /**
   * Create an API key for a specific tenant
   */
  async createForTenant(
    userId: string,
    tenantId: string,
    apiKeyData: Partial<ApiKey>,
  ): Promise<ApiKey> {
    const apiKey = this.apiKeyRepo.create({
      ...apiKeyData,
      userId,
      tenantId,
      isActive: true,
    });

    return this.apiKeyRepo.save(apiKey);
  }

  /**
   * Get all API keys for a tenant
   */
  async getByTenant(tenantId: string): Promise<ApiKey[]> {
    return this.apiKeyRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Get all API keys for a user within their current tenant
   */
  async getByUserInTenant(userId: string, tenantId: string): Promise<ApiKey[]> {
    return this.apiKeyRepo.find({
      where: { userId, tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Verify tenant isolation - ensure user can only access their tenant's keys
   */
  async verifyTenantIsolation(apiKeyId: string, tenantId: string): Promise<boolean> {
    const apiKey = await this.apiKeyRepo.findOne({
      where: { id: apiKeyId, tenantId },
    });

    if (!apiKey) {
      throw new ForbiddenException(
        'API key does not belong to this tenant',
      );
    }

    return true;
  }

  /**
   * Revoke all API keys for a tenant (for emergency access control)
   */
  async revokeByTenant(tenantId: string): Promise<number> {
    const result = await this.apiKeyRepo.update(
      { tenantId, isActive: true },
      { isActive: false },
    );

    return result.affected || 0;
  }

  /**
   * Check if current request context is valid for accessing tenant's API key
   */
  async validateTenantAccess(apiKeyId: string): Promise<ApiKey> {
    const tenantContext = TenantContextProvider.getTenantContext();

    if (!tenantContext) {
      throw new ForbiddenException('No tenant context found');
    }

    const apiKey = await this.apiKeyRepo.findOne({
      where: { id: apiKeyId, tenantId: tenantContext.tenantId },
    });

    if (!apiKey) {
      throw new ForbiddenException(
        'API key not found or does not belong to current tenant',
      );
    }

    if (!apiKey.isActive) {
      throw new ForbiddenException('API key is not active');
    }

    return apiKey;
  }
}
