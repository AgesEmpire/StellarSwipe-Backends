import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_FILTER } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { join } from 'path';
import {
  fieldExtensionsEstimator,
  simpleEstimator,
  getComplexity,
} from 'graphql-query-complexity';
import { GraphQLSchema } from 'graphql';
import { Reflector } from '@nestjs/core';
import { PubSub } from 'graphql-subscriptions';

// ─── Subscription (WS) authentication ────────────────────────────────────────
import { createGraphqlWsAuthHandlers } from './ws-subscription-auth';
import { AuthModule } from '../auth/auth.module';
import { SessionManagerService } from '../auth/session/session-manager.service';
import { UsersService } from '../users/users.service';

// ─── Scalars ─────────────────────────────────────────────────────────────────
import { DateTimeScalar } from './scalars/datetime.scalar';
import { JsonScalar } from './scalars/json.scalar';

// ─── Guards ───────────────────────────────────────────────────────────────────
// GqlOwnershipGuard is provided/exported by AuthorizationModule (already imported below).
import { GqlAuthGuard } from './guards/gql-auth.guard';

// ─── Filters ──────────────────────────────────────────────────────────────────
import { GraphqlExceptionFilter } from './filters/gql-exception.filter';

// ─── Plugins ──────────────────────────────────────────────────────────────────
import { GqlLoggingPlugin } from './plugins/gql-logging.plugin';
import { GqlDepthLimitPlugin } from './plugins/gql-depth-limit.plugin';
import { FieldAuthorizationPlugin } from './plugins/field-auth.plugin';
import { SlowFieldLoggingPlugin } from './plugins/slow-field-logging.plugin';

// ─── Resolvers ────────────────────────────────────────────────────────────────
import { SignalResolver } from './resolvers/signal.resolver';
import { TradeResolver } from './resolvers/trade.resolver';
import { PortfolioResolver } from './resolvers/portfolio.resolver';
import { ProviderResolver } from './resolvers/provider.resolver';
import { UserResolver } from './resolvers/user.resolver';
import { SignalSubscriptionResolver } from './signal-subscription.resolver';
import { ApiVersionResolver } from './resolvers/api-version.resolver';

// ─── Domain modules ───────────────────────────────────────────────────────────
import { SignalsModule } from '../signals/signals.module';
import { TradesModule } from '../trades/trades.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { ProvidersModule } from '../providers/providers.module';
import { UsersModule } from '../users/users.module';
import { AssetsModule } from '../assets/assets.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { VersioningModule } from '../versioning/versioning.module';

// ─── Utils ────────────────────────────────────────────────────────────────────
import { createDataLoader, createGroupedDataLoader } from './utils/dataloader-factory';
import {
  simpleComplexityEstimator,
  getComplexityLimit,
  resolveUserRole,
} from './utils/complexity-calculator';
import { ProvidersService } from '../providers/providers.service';
import { SignalsService } from '../signals/signals.service';
import { AssetsService } from '../assets/assets.service';

@Module({
  imports: [
    // Domain modules — resolvers depend on their services
    SignalsModule,
    TradesModule,
    PortfolioModule,
    ProvidersModule,
    AssetsModule,
    UsersModule,
    AuthorizationModule,
    VersioningModule,

    // AuthModule → SessionManagerService (session-revocation check reused by
    // the subscription handshake authenticator below).
    AuthModule,
    // Own JwtModule registration so `JwtService` can verify the token sent
    // via `connectionParams` on a `graphql-ws` `connection_init` message.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('jwt.secret'),
        signOptions: {
          expiresIn: configService.get('jwt.expiresIn'),
        },
      }),
    }),

    NestGraphQLModule.forRootAsync<ApolloDriverConfig>({
      driver: ApolloDriver,
      inject: [
        ProvidersService,
        SignalsService,
        ConfigService,
        AssetsService,
        JwtService,
        UsersService,
        SessionManagerService,
      ],
      useFactory: (
        providersService: ProvidersService,
        signalsService: SignalsService,
        configService: ConfigService,
        assetsService: AssetsService,
        jwtService: JwtService,
        usersService: UsersService,
        sessionManager: SessionManagerService,
      ) => ({
        /** Code-first schema — NestJS generates schema.gql automatically. */
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
            assetByCode: createDataLoader(
              async (codes) => assetsService.findByCodes(codes as string[]),
              (a) => a.code || a.id,
            ),
          },
        }),

        /** Apollo plugins registered here (complexity is a validation rule, not a plugin). */
        plugins: [],

        /**
         * Per-request query complexity enforcement.
         *
         * The validation rule runs *before* execution so over-complex queries
         * are rejected with a GraphQL-level error rather than consuming server
         * resources. The limit is raised for `admin` and `pro` roles so power
         * users can run richer queries while anonymous / default users are
         * protected with a tighter cap.
         *
         * Limit resolution order:
         *   1. `GRAPHQL_COMPLEXITY_LIMIT_<ROLE>` env var (upper-cased role)
         *   2. Hard-coded defaults in `utils/complexity-calculator.ts`
         */
        validationRules: (schema: GraphQLSchema, document: unknown, variables: unknown, context: unknown) => [
          () => {
            const complexity = getComplexity({
              schema,
              query: document as any,
              variables: variables as Record<string, unknown>,
              estimators: [
                fieldExtensionsEstimator(),
                simpleComplexityEstimator(),
                simpleEstimator({ defaultComplexity: 1 }),
              ],
            });

            // Resolve the per-role limit from the request context.
            // `context` is the per-request GQL context created in `context` factory above.
            const user = (context as any)?.req?.user ?? (context as any)?.user;
            const role = resolveUserRole(user);
            const limit = getComplexityLimit(role);

            if (complexity > limit) {
              throw new Error(
                `Query complexity ${complexity} exceeds the limit of ${limit} for role "${role ?? 'default'}". ` +
                  `Reduce nesting depth, request fewer list items, or remove expensive fields.`,
              );
            }

            if (configService.get<string>('NODE_ENV') !== 'production') {
              const roleLabel = role ?? 'default';
              // eslint-disable-next-line no-console
              console.debug(`[GraphQL] complexity: ${complexity}/${limit} (role: ${roleLabel})`);
            }
          },
        ],

        /** Expose playground in non-production environments */
        playground: configService.get<string>('NODE_ENV') !== 'production',

        /**
         * Subscriptions over WS.
         */
        subscriptions: {
          'graphql-ws': createGraphqlWsAuthHandlers({
            jwtService,
            configService,
            usersService,
            sessionManager,
          }),
        },

        /** Format errors before returning to client */
        formatError: (error) => {
          const isProd = configService.get<string>('NODE_ENV') === 'production';
          return {
            message: error.message,
            code: error.extensions?.code,
            ...(isProd ? {} : { locations: error.locations, path: error.path }),
          };
        },

        /** Introspection for tooling */
        introspection: true,

        /** CORS handled at app level */
        cors: false,
      }),
    }),
  ],

  providers: [
    // Scalars
    DateTimeScalar,
    JsonScalar,

    // Guard
    GqlAuthGuard,
    Reflector,

    // Exception filter
    { provide: APP_FILTER, useClass: GraphqlExceptionFilter },

    // Apollo plugins
    GqlLoggingPlugin,
    GqlDepthLimitPlugin,
    FieldAuthorizationPlugin,
    SlowFieldLoggingPlugin,

    // PubSub for subscriptions
    { provide: PubSub, useValue: new PubSub() },

    // Resolvers
    SignalResolver,
    TradeResolver,
    PortfolioResolver,
    ProviderResolver,
    UserResolver,
    SignalSubscriptionResolver,
    ApiVersionResolver,
  ],

  exports: [GqlAuthGuard],
})
export class GraphqlModule {}
