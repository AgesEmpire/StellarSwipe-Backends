import { Module } from '@nestjs/common';
import { GraphQLModule as NestGraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_FILTER } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { join } from 'path';
import { fieldExtensionsEstimator, simpleEstimator, getComplexity } from 'graphql-query-complexity';
import { GraphQLSchema } from 'graphql';
import { Reflector } from '@nestjs/core';
import { PubSub } from 'graphql-subscriptions';

// ─── Subscription (WS) authentication ────────────────────────────────────────
// Enforces auth at graphql-ws handshake time (see `subscriptions` config
// below) instead of only at the HTTP `context` factory, which never runs for
// WS connections.
import { createGraphqlWsAuthHandlers } from './ws-subscription-auth';
import { AuthModule } from '../auth/auth.module';
import { SessionManagerService } from '../auth/session/session-manager.service';
import { UsersService } from '../users/users.service';

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
import { FieldAuthorizationPlugin } from './plugins/field-auth.plugin';
import { SlowFieldLoggingPlugin } from './plugins/slow-field-logging.plugin';

// ─── Resolvers ────────────────────────────────────────────────────────────────
import { SignalResolver } from './resolvers/signal.resolver';
import { TradeResolver } from './resolvers/trade.resolver';
import { PortfolioResolver } from './resolvers/portfolio.resolver';
import { ProviderResolver } from './resolvers/provider.resolver';
import { UserResolver } from './resolvers/user.resolver';
import { SignalSubscriptionResolver } from './signal-subscription.resolver';

// ─── Domain modules ───────────────────────────────────────────────────────────
import { SignalsModule } from '../signals/signals.module';
import { TradesModule } from '../trades/trades.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { ProvidersModule } from '../providers/providers.module';
import { UsersModule } from '../users/users.module';
import { AssetsModule } from '../assets/assets.module';
import { AuthorizationModule } from '../authorization/authorization.module';

// ─── Utils ────────────────────────────────────────────────────────────────────
import { createDataLoader, createGroupedDataLoader } from './utils/dataloader-factory';
import {
  simpleComplexityEstimator,
  getComplexityLimit,
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

    // AuthModule → SessionManagerService (session-revocation check reused by
    // the subscription handshake authenticator below).
    AuthModule,
    // Own JwtModule registration (same `jwt.secret` config key AuthModule's
    // JwtStrategy/JwtModule use) so `JwtService` can verify the token sent
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
            // Asset metadata loader (per-request) — batches asset lookups by code
            assetByCode: createDataLoader(
              async (codes) => assetsService.findByCodes(codes as string[]),
              (a) => a.code || a.id,
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
            if (configService.get<string>('NODE_ENV') !== 'production') {
              console.debug(`[GraphQL] complexity: ${complexity}/${limit}`);
            }
          },
        ],

        /** Expose playground in non-production environments */
        playground: configService.get<string>('NODE_ENV') !== 'production',

        /**
         * Subscriptions over WS.
         *
         * `onConnect` runs once per WS connection at `connection_init`
         * (handshake) time — it validates the bearer token the client sends
         * via `connectionParams` and *throws* to refuse the connection
         * before any subscription can be created if it's missing/invalid.
         * `context` runs once per subscription operation on an already
         * accepted connection and merges the authenticated user resolved
         * during the handshake into `context.user`, so `@Subscription()`
         * resolvers and `GqlAuthGuard` can read it (there is no HTTP `req`
         * for WS connections, unlike the `context` factory above).
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
  ],

  exports: [GqlAuthGuard],
})
export class GraphqlModule {}