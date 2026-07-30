import { Resolver, Query, ObjectType, Field } from '@nestjs/graphql';
import { VersionManagerService } from '../../versioning/version-manager.service';

@ObjectType()
export class GqlApiVersionType {
  @Field()
  version: string;

  @Field()
  status: string;

  @Field({ nullable: true })
  sunsetDate?: string;

  @Field({ nullable: true })
  successorVersion?: string;

  @Field()
  description: string;
}

/**
 * Exposes the same version/deprecation metadata REST clients get via
 * response headers (see VersionResolverMiddleware) to GraphQL clients,
 * which have no HTTP headers to inspect per-field.
 */
@Resolver()
export class ApiVersionResolver {
  constructor(private readonly versionManager: VersionManagerService) {}

  @Query(() => GqlApiVersionType, {
    description: 'Current GraphQL schema version and deprecation status.',
  })
  apiVersion(): GqlApiVersionType {
    const version = this.versionManager.getDefaultVersion();
    const metadata = this.versionManager.getVersionMetadata(version);

    return {
      version,
      status: metadata?.status ?? 'unknown',
      sunsetDate: metadata?.sunsetDate,
      successorVersion: metadata?.successorVersion,
      description: metadata?.description ?? '',
    };
  }
}
