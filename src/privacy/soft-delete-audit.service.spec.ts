import { Test } from '@nestjs/testing';
import { DataSource, EntityMetadata } from 'typeorm';
import { SoftDeleteAuditService, RetentionRuleConfig } from './soft-delete-audit.service';

describe('SoftDeleteAuditService', () => {
  let service: SoftDeleteAuditService;
  let mockDataSource: jest.Mocked<DataSource>;

  beforeEach(async () => {
    mockDataSource = {
      entityMetadatas: [],
    } as any;

    const module = await Test.createTestingModule({
      providers: [
        SoftDeleteAuditService,
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<SoftDeleteAuditService>(SoftDeleteAuditService);
  });

  describe('auditEntity', () => {
    it('should mark entity as no_soft_delete if it has no DeleteDateColumn', () => {
      const mockMeta = {
        name: 'User',
        tableName: 'users',
        deletionDateColumn: null,
      } as any;

      const result = service.auditEntity(mockMeta, {});

      expect(result.status).toBe('no_soft_delete');
      expect(result.hasSoftDelete).toBe(false);
      expect(result.hasRetentionRule).toBe(false);
    });

    it('should mark entity as covered if it has soft-delete and retention rule', () => {
      const mockMeta = {
        name: 'User',
        tableName: 'users',
        deletionDateColumn: { name: 'deletedAt' },
      } as any;

      const rules: RetentionRuleConfig = {
        User: { days: 30, description: 'Delete user PII after 30 days' },
      };

      const result = service.auditEntity(mockMeta, rules);

      expect(result.status).toBe('covered');
      expect(result.hasSoftDelete).toBe(true);
      expect(result.hasRetentionRule).toBe(true);
      expect(result.retentionDays).toBe(30);
    });

    it('should mark entity as uncovered if it has soft-delete but no retention rule', () => {
      const mockMeta = {
        name: 'Order',
        tableName: 'orders',
        deletionDateColumn: { name: 'deletedAt' },
      } as any;

      const rules: RetentionRuleConfig = {
        User: { days: 30 },
      };

      const result = service.auditEntity(mockMeta, rules);

      expect(result.status).toBe('uncovered');
      expect(result.hasSoftDelete).toBe(true);
      expect(result.hasRetentionRule).toBe(false);
    });
  });

  describe('auditAllEntities', () => {
    it('should audit all entities in the schema', () => {
      const mockMetas = [
        {
          name: 'User',
          tableName: 'users',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'Order',
          tableName: 'orders',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'Product',
          tableName: 'products',
          deletionDateColumn: null,
        },
      ] as any[];

      mockDataSource.entityMetadatas = mockMetas;

      const rules: RetentionRuleConfig = {
        User: { days: 30 },
      };

      const results = service.auditAllEntities(rules);

      expect(results).toHaveLength(3);
      expect(results[0].status).toBe('covered');
      expect(results[1].status).toBe('uncovered');
      expect(results[2].status).toBe('no_soft_delete');
    });
  });

  describe('findUncoveredEntities', () => {
    it('should return only uncovered soft-deletable entities', () => {
      const mockMetas = [
        {
          name: 'User',
          tableName: 'users',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'Order',
          tableName: 'orders',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'Signal',
          tableName: 'signals',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'Product',
          tableName: 'products',
          deletionDateColumn: null,
        },
      ] as any[];

      mockDataSource.entityMetadatas = mockMetas;

      const rules: RetentionRuleConfig = {
        User: { days: 30 },
        Signal: { days: 90 },
      };

      const uncovered = service.findUncoveredEntities(rules);

      expect(uncovered).toHaveLength(1);
      expect(uncovered[0].entityName).toBe('Order');
      expect(uncovered[0].status).toBe('uncovered');
    });

    it('should return empty array when all soft-deletable entities are covered', () => {
      const mockMetas = [
        {
          name: 'User',
          tableName: 'users',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'Order',
          tableName: 'orders',
          deletionDateColumn: { name: 'deletedAt' },
        },
      ] as any[];

      mockDataSource.entityMetadatas = mockMetas;

      const rules: RetentionRuleConfig = {
        User: { days: 30 },
        Order: { days: 60 },
      };

      const uncovered = service.findUncoveredEntities(rules);

      expect(uncovered).toHaveLength(0);
    });
  });

  describe('validateAndLogAudit', () => {
    it('should throw error when uncovered soft-deletable entities are found', () => {
      const mockMetas = [
        {
          name: 'User',
          tableName: 'users',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'UncoveredEntity',
          tableName: 'uncovered_entities',
          deletionDateColumn: { name: 'deletedAt' },
        },
      ] as any[];

      mockDataSource.entityMetadatas = mockMetas;

      const rules: RetentionRuleConfig = {
        User: { days: 30 },
      };

      expect(() => service.validateAndLogAudit(rules)).toThrow(
        expect.stringContaining('CRITICAL'),
      );
      expect(() => service.validateAndLogAudit(rules)).toThrow(
        expect.stringContaining('UncoveredEntity'),
      );
    });

    it('should not throw when all soft-deletable entities have retention rules', () => {
      const mockMetas = [
        {
          name: 'User',
          tableName: 'users',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'Order',
          tableName: 'orders',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'Product',
          tableName: 'products',
          deletionDateColumn: null,
        },
      ] as any[];

      mockDataSource.entityMetadatas = mockMetas;

      const rules: RetentionRuleConfig = {
        User: { days: 30 },
        Order: { days: 60 },
      };

      expect(() => service.validateAndLogAudit(rules)).not.toThrow();
    });

    it('should include entity names in error message for debugging', () => {
      const mockMetas = [
        {
          name: 'Order',
          tableName: 'orders',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'Invoice',
          tableName: 'invoices',
          deletionDateColumn: { name: 'deletedAt' },
        },
      ] as any[];

      mockDataSource.entityMetadatas = mockMetas;
      const rules: RetentionRuleConfig = {};

      expect(() => service.validateAndLogAudit(rules)).toThrow(
        expect.stringContaining('Order'),
      );
      expect(() => service.validateAndLogAudit(rules)).toThrow(
        expect.stringContaining('Invoice'),
      );
    });
  });

  describe('integration test: fixture entity without retention rule', () => {
    it('should detect an intentionally uncovered test fixture entity', () => {
      const mockMetas = [
        {
          name: 'User',
          tableName: 'users',
          deletionDateColumn: { name: 'deletedAt' },
        },
        {
          name: 'TestFixtureUncovered',
          tableName: 'test_fixture_uncovered',
          deletionDateColumn: { name: 'deletedAt' },
        },
      ] as any[];

      mockDataSource.entityMetadatas = mockMetas;

      const rules: RetentionRuleConfig = {
        User: { days: 30 },
        // TestFixtureUncovered intentionally not included to test audit detection
      };

      const uncovered = service.findUncoveredEntities(rules);
      expect(uncovered).toHaveLength(1);
      expect(uncovered[0].entityName).toBe('TestFixtureUncovered');

      expect(() => service.validateAndLogAudit(rules)).toThrow();
    });
  });
});
