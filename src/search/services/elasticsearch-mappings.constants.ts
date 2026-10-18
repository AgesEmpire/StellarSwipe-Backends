import { IndexMapping } from './index-mapping.interface';

/**
 * Expected Elasticsearch mappings for each application index, as the
 * application code understands them. These are the single source of truth
 * used both to create indices (ElasticsearchConfigService) and to validate
 * deployed indices against drift before traffic switches over to them
 * (MappingValidationService — see issue #1365).
 */
export const SIGNALS_INDEX_MAPPING: IndexMapping = {
  properties: {
    id: { type: 'keyword' },
    assetPair: { type: 'keyword' },
    baseAsset: { type: 'keyword' },
    counterAsset: { type: 'keyword' },
    action: { type: 'keyword' },
    rationale: {
      type: 'text',
      analyzer: 'english',
      fields: {
        keyword: { type: 'keyword' },
      },
    },
    providerId: { type: 'keyword' },
    providerName: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' },
      },
    },
    entryPrice: { type: 'float' },
    targetPrice: { type: 'float' },
    stopLossPrice: { type: 'float' },
    currentPrice: { type: 'float' },
    createdAt: { type: 'date' },
    closedAt: { type: 'date' },
    status: { type: 'keyword' },
    outcome: { type: 'keyword' },
    winRate: { type: 'float' },
    successRate: { type: 'float' },
    confidenceScore: { type: 'integer' },
    suggest: {
      type: 'completion',
      analyzer: 'simple',
    },
  },
};

export const PROVIDERS_INDEX_MAPPING: IndexMapping = {
  properties: {
    id: { type: 'keyword' },
    username: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' },
      },
    },
    displayName: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' },
      },
    },
    bio: {
      type: 'text',
      analyzer: 'english',
    },
    reputationScore: { type: 'integer' },
    createdAt: { type: 'date' },
    suggest: {
      type: 'completion',
      analyzer: 'simple',
    },
  },
};

export const CONTENT_INDEX_MAPPING: IndexMapping = {
  properties: {
    id: { type: 'keyword' },
    providerId: { type: 'keyword' },
    providerName: {
      type: 'text',
      fields: {
        keyword: { type: 'keyword' },
      },
    },
    type: { type: 'keyword' },
    title: {
      type: 'text',
      analyzer: 'english',
      fields: {
        keyword: { type: 'keyword' },
      },
    },
    body: {
      type: 'text',
      analyzer: 'english',
    },
    tags: { type: 'keyword' },
    status: { type: 'keyword' },
    views: { type: 'integer' },
    likes: { type: 'integer' },
    createdAt: { type: 'date' },
    suggest: {
      type: 'completion',
      analyzer: 'simple',
    },
  },
};

/** Expected mapping per index name, as deployed by ElasticsearchConfigService. */
export const EXPECTED_INDEX_MAPPINGS: Record<string, IndexMapping> = {
  signals: SIGNALS_INDEX_MAPPING,
  providers: PROVIDERS_INDEX_MAPPING,
  content: CONTENT_INDEX_MAPPING,
};
