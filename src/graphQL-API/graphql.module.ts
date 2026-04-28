import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_FILTER } from '@nestjs/core';
import { join } from 'path';
import { fieldExtensionsEstimator, simpleEstimator, getComplexity } from 'graphql-query-complexity';
import { GraphQLSchema } from 'graphql';
import { Reflector } from '@nestjs/core';

// ─── Scalars ─────────────────────────────────────────────────────────────────
import { DateTimeScalar } from './scalars/datetime.scalar';
import { JsonScalar } from './scalars/json.scalar';

// ─── Guards ───────────────────────────────────────────────────────────────────
import { GqlAuthGuard } from './guards/gql-auth.guard';

// ─── Filters ──────────────────────────────────────────────────────────────────
import { GraphqlExceptionFilter } from './filters/gql-exception.filter';

// ─── Plugins ──────────────────────────────────────────────────────────────────
import { GqlLoggingPlugin } from './plugins/gql-logging.plugin';
import { GqlDepthLimitPlugin } from './plugins/gql-depth-limit.plugin';

// ─── Resolvers ────────────────────────────────────────────────────────────────
import { SignalResolver } from './resolvers/signal.resolver';
import { TradeResolver } from './resolvers/trade.resolver';
import { PortfolioResolver } from './resolvers/portfolio.resolver';
import { ProviderResolver } from './resolvers/provider.resolver';
import { UserResolver } from './resolvers/user.resolver';

// ─── Domain modules ───────────────────────────────────────────────────────────
import { SignalsModule } from '../signals/signals.module';
import { TradesModule } from '../trades/trades.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { ProvidersModule } from '../providers/providers.module';
import { UsersModule } from '../users/users.module';

// ─── Utils ────────────────────────────────────────────────────────────────────
import { createDataLoader, createGroupedDataLoader } from './utils/dataloader-factory';
import {
  simpleComplexityEstimator,
  getComplexityLimit,
} from './utils/complexity-calculator';
import { ProvidersService } from '../providers/providers.service';
import { SignalsService } from '../signals/signals.service';

@Module({
  imports: [
    // Domain modules — resolvers depend on their services
    SignalsModule,
    TradesModule,
    PortfolioModule,
    ProvidersModule,
    UsersModule,

    NestGraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [ProvidersService, SignalsService],
      useFactory: (providersService: ProvidersService, signalsService: SignalsService) => ({
        /**
         * Code-first schema — NestJS generates schema.gql automatically.
         * The file is written to disk so you can inspect or commit it.
         */
        autoSchemaFile: join(process.cwd(), 'src/graphql/schema.gql'),
        sortSchema: true,

        /** Attach DataLoaders to every request context to solve N+1 at resolver level. */
        context: ({ req }: { req: Request }) => ({
          req,
          loaders: {
            providerById: createDataLoader(
              (ids) => providersService.findByIds(ids as string[]),
              (p) => p.id,
            ),
            signalsByProviderId: createGroupedDataLoader(
              (providerIds) => signalsService.findByProviderIds(providerIds as string[]),
              (s) => s.providerId,
            ),
          },
        }),

        /** Query complexity limits to protect against deeply-nested DoS queries. */
        plugins: [],

        /** Validation rule for complexity — runs before execution */
        validationRules: (schema: GraphQLSchema, document: unknown, variables: unknown) => [
          () => {
            const complexity = getComplexity({
              schema,
              query: document as any,
              variables: variables as Record<string, unknown>,
              estimators: [
                fieldExtensionsEstimator(),
                simpleEstimator({ defaultComplexity: 1 }),
              ],
            });
            const limit = getComplexityLimit();
            if (complexity > limit) {
              throw new Error(
                `Query complexity ${complexity} exceeds limit of ${limit}. Simplify your query.`,
              );
            }
            if (process.env.NODE_ENV !== 'production') {
              console.debug(`[GraphQL] complexity: ${complexity}/${limit}`);
            }
          },
        ],

        /** Expose playground in non-production environments */
        playground: process.env.NODE_ENV !== 'production',

        /** Subscriptions over WS — enable when needed */
        subscriptions: {
          'graphql-ws': false,
          'subscriptions-transport-ws': false,
        },

        /** Format errors before returning to client — strip internals in prod */
        formatError: (error) => {
          const isProd = process.env.NODE_ENV === 'production';
          return {
            message: error.message,
            code: error.extensions?.code,
            ...(isProd ? {} : { locations: error.locations, path: error.path }),
          };
        },

        /** Persist introspection in all envs for tooling (Postman, Apollo Studio) */
        introspection: true,

        /** Include request in context for guards / decorators */
        installSubscriptionHandlers: false,

        /** CORS handled at app level — don't double-apply */
        cors: false,
      }),
    }),
  ],

  providers: [
    // Scalars
    DateTimeScalar,
    JsonScalar,

    // Guard (registered globally via APP_GUARD in AppModule — listed here for clarity)
    GqlAuthGuard,
    Reflector,

    // Exception filter — scoped to GraphQL layer
    { provide: APP_FILTER, useClass: GraphqlExceptionFilter },

    // Apollo plugins (decorated with @Plugin())
    GqlLoggingPlugin,
    GqlDepthLimitPlugin,

    // Resolvers
    SignalResolver,
    TradeResolver,
    PortfolioResolver,
    ProviderResolver,
    UserResolver,
  ],

  exports: [GqlAuthGuard],
})
export class GraphqlModule {}
