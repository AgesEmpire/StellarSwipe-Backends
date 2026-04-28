import { ApolloServerPlugin, GraphQLRequestContext, GraphQLRequestListener } from '@apollo/server';
import { Plugin } from '@nestjs/apollo';
import { GraphQLError, DocumentNode, FieldNode, SelectionSetNode } from 'graphql';

const DEFAULT_MAX_DEPTH = 7;

function measureDepth(node: SelectionSetNode | undefined, current = 0): number {
  if (!node) return current;
  return node.selections.reduce((max, selection) => {
    if (selection.kind === 'Field') {
      const fieldNode = selection as FieldNode;
      const childDepth = fieldNode.selectionSet
        ? measureDepth(fieldNode.selectionSet, current + 1)
        : current + 1;
      return Math.max(max, childDepth);
    }
    return max;
  }, current);
}

function getMaxDepth(doc: DocumentNode): number {
  let max = 0;
  for (const def of doc.definitions) {
    if (def.kind === 'OperationDefinition' && def.selectionSet) {
      max = Math.max(max, measureDepth(def.selectionSet));
    }
  }
  return max;
}

/**
 * Blocks queries that exceed MAX_DEPTH nesting levels.
 * Prevents clients from crafting exponentially expensive traversals.
 *
 * @example
 * # Depth 3 — fine
 * { providers { stats { winRate } } }
 *
 * # Depth 5 — rejected if limit is 4
 * { providers { recentSignals { provider { stats { winRate } } } } }
 */
@Plugin()
export class GqlDepthLimitPlugin implements ApolloServerPlugin {
  private readonly maxDepth: number;

  constructor(maxDepth = DEFAULT_MAX_DEPTH) {
    this.maxDepth = maxDepth;
  }

  async requestDidStart(
    _ctx: GraphQLRequestContext<Record<string, unknown>>,
  ): Promise<GraphQLRequestListener<Record<string, unknown>>> {
    const { maxDepth } = this;

    return {
      async didResolveDocument({ document }) {
        const depth = getMaxDepth(document);
        if (depth > maxDepth) {
          throw new GraphQLError(
            `Query depth ${depth} exceeds maximum allowed depth of ${maxDepth}.`,
            { extensions: { code: 'QUERY_TOO_DEEP' } },
          );
        }
      },
    };
  }
}
