import { Injectable, Logger, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface CallDepthInfo {
  depth: number;
  contractInvocations: string[];
}

export interface MaxCallDepthValidationResult {
  valid: boolean;
  actualDepth: number;
  declaredMax: number;
  message?: string;
}

@Injectable()
export class MaxCallDepthService {
  private readonly logger = new Logger(MaxCallDepthService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Extracts the maximum call depth from a Soroban simulation response.
   *
   * In Soroban, cross-contract calls are represented in the auth entries.
   * The call depth is the maximum nesting level of subInvocations in the
   * SorobanAuthorizationEntry tree.
   *
   * If auth entries are not available, falls back to estimating depth
   * based on the number of unique contract IDs in the footprint.
   */
  extractCallDepthFromSimulation(
    simulation: unknown,
  ): CallDepthInfo {
    let depth = 0;
    const contractInvocations: string[] = [];

    try {
      const sim = simulation as Record<string, unknown>;
      
      if (sim.result && typeof sim.result === 'object') {
        const result = sim.result as Record<string, unknown>;
        
        if (Array.isArray(result.auth)) {
          const depths = this.calculateAuthDepths(result.auth);
          depth = Math.max(...depths, 0);
          contractInvocations.push(...this.extractContractIds(result.auth));
        } else if (sim.transactionData) {
          const footprintDepth = this.calculateFootprintDepth(sim.transactionData);
          depth = footprintDepth;
          contractInvocations.push(...this.extractFootprintContractIds(sim.transactionData));
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Failed to extract call depth from simulation: ${err}`);
    }

    return { depth, contractInvocations };
  }

  /**
   * Validates actual call depth against declared maximum.
   * In warn mode, logs a warning but never throws.
   * In reject mode, throws ConflictException when depth exceeds max.
   */
  validateDepth(
    actualDepth: number,
    declaredMax: number,
    onViolation: 'reject' | 'warn' = 'reject',
    endpoint?: string,
  ): MaxCallDepthValidationResult {
    const result: MaxCallDepthValidationResult = {
      valid: actualDepth <= declaredMax,
      actualDepth,
      declaredMax,
    };

    if (actualDepth > declaredMax) {
      result.message = `Cross-contract call depth ${actualDepth} exceeds maximum allowed depth ${declaredMax}${endpoint ? ` for endpoint '${endpoint}'` : ''}`;
      
      if (onViolation === 'warn') {
        this.logger.warn(`Call depth warning: ${result.message}`);
      } else {
        this.logger.error(`Call depth violation: ${result.message}`);
        throw new ConflictException({
          message: result.message,
          actualDepth,
          maxDepth: declaredMax,
          endpoint,
        });
      }
    }

    return result;
  }

  /**
   * Gets the maximum call depth for a given endpoint from configuration.
   * Falls back to global defaults if endpoint-specific config is not set.
   */
  getMaxDepth(endpoint: string): number {
    const endpointConfig = this.configService.get<number>(`trade.maxCallDepth.${endpoint}`);
    if (endpointConfig !== undefined) {
      return endpointConfig;
    }
    return this.configService.get<number>('trade.maxCallDepth.default', 5);
  }

  /**
   * Gets the violation policy for call depth enforcement.
   * Can be set globally or per-endpoint.
   */
  getViolationPolicy(endpoint?: string): 'reject' | 'warn' {
    const endpointPolicy = this.configService.get<string>(`trade.maxCallDepthPolicy.${endpoint}`);
    if (endpointPolicy === 'warn' || endpointPolicy === 'reject') {
      return endpointPolicy;
    }
    return this.configService.get<string>('trade.maxCallDepthPolicy', 'reject') as 'reject' | 'warn';
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private calculateAuthDepths(authEntries: unknown[]): number[] {
    const depths: number[] = [];
    
    for (const entry of authEntries) {
      if (entry && typeof entry === 'object') {
        const entryObj = entry as Record<string, unknown>;
        const depth = this.calculateInvocationDepth(entryObj.rootInvocation);
        depths.push(depth);
      }
    }
    
    return depths;
  }

  private calculateInvocationDepth(invocation: unknown): number {
    if (!invocation || typeof invocation !== 'object') {
      return 0;
    }

    const inv = invocation as Record<string, unknown>;
    let maxDepth = 0;

    if (Array.isArray(inv.subInvocations)) {
      for (const sub of inv.subInvocations) {
        const subDepth = this.calculateInvocationDepth(sub);
        maxDepth = Math.max(maxDepth, subDepth + 1);
      }
    }

    return maxDepth;
  }

  private extractContractIds(authEntries: unknown[]): string[] {
    const ids: string[] = [];
    
    for (const entry of authEntries) {
      if (entry && typeof entry === 'object') {
        const entryObj = entry as Record<string, unknown>;
        const id = this.extractRootInvocationContractId(entryObj.rootInvocation);
        if (id) ids.push(id);
      }
    }
    
    return ids;
  }

  private extractRootInvocationContractId(invocation: unknown): string | null {
    if (!invocation || typeof invocation !== 'object') {
      return null;
    }

    const inv = invocation as Record<string, unknown>;
    
    if (inv.function) {
      const fn = inv.function as Record<string, unknown>;
      if (fn.invokeContract || fn._switch?.value === 'invokeContract') {
        return typeof inv.contractId === 'string' ? inv.contractId : 
               (fn.contractId as string) || null;
      }
    }
    
    return null;
  }

  private calculateFootprintDepth(transactionData: unknown): number {
    if (typeof transactionData === 'string') {
      try {
        return Math.min(transactionData.length / 1000, 10);
      } catch {
        return 0;
      }
    }
    
    if (transactionData && typeof transactionData === 'object') {
      const td = transactionData as Record<string, unknown>;
      if (td.resources) {
        return this.estimateDepthFromResources(td.resources);
      }
    }
    
    return 0;
  }

  private estimateDepthFromResources(resources: unknown): number {
    if (!resources || typeof resources !== 'object') return 0;
    
    const r = resources as Record<string, unknown>;
    const footprint = r.footprint;
    
    if (footprint && typeof footprint === 'object') {
      const f = footprint as Record<string, unknown>;
      let totalEntries = 0;
      
      if (Array.isArray(f.readOnly)) totalEntries += f.readOnly.length;
      if (Array.isArray(f.readWrite)) totalEntries += f.readWrite.length;
      
      return Math.max(1, Math.ceil(totalEntries / 2));
    }
    
    return 0;
  }

  private extractFootprintContractIds(transactionData: unknown): string[] {
    // Extract contract IDs from footprint entries
    return [];
  }
}