import {
  ApolloServerPlugin,
  GraphQLRequestContext,
  GraphQLRequestListener,
} from '@apollo/server';
import { Plugin, Field } from '@nestjs/graphql';
import { Logger, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionChecker } from '../../authorization/utils/permission-checker';

/**
 * Field-level authorization metadata key
 */
export const FIELD_AUTH_KEY = 'graphql:field:authorization';

/**
 * Field-level authorization options
 */
export interface FieldAuthOptions {
  permissions?: string[];
  roles?: string[];
  requireAll?: boolean;
}

/**
 * Decorator to add authorization to GraphQL fields.
 * Use with @Field() to protect individual fields.
 * 
 * @example
 * ```ts
 * @ObjectType()
 * export class UserType {
 *   @Field()
 *   email: string;
 * 
 *   @Field(() => String, { 
 *     nullable: true,
 *     extensions: { 
 *       authorization: { permissions: ['users:read'] } 
 *     }
 *   })
 *   sensitiveData: string;
 * }
 * ```
 */
export function AuthorizedField(
  typeFunc: () => any,
  options: FieldAuthOptions & { nullable?: boolean; description?: string } = {},
) {
  return Field(typeFunc, {
    nullable: options.nullable,
    description: options.description,
    extensions: {
      [FIELD_AUTH_KEY]: options,
    },
  });
}

/**
 * GraphQL plugin for field-level authorization.
 * Intercepts field resolution and checks permissions.
 * Unauthorized fields return null instead of failing the entire query.
 */
@Plugin()
@Injectable()
export class FieldAuthorizationPlugin implements ApolloServerPlugin {
  private readonly logger = new Logger(FieldAuthorizationPlugin.name);

  constructor(private permissionChecker: PermissionChecker) {}

  async requestDidStart(
    requestContext: GraphQLRequestContext,
  ): Promise<GraphQLRequestListener> {
    return {
      async willResolveField({ info, context }) {
        const fieldAuth = this.extractFieldAuth(info);
        if (!fieldAuth) return;

        const user = (context as any)?.req?.user;
        if (!user?.id) return;

        const hasAccess = await this.checkAccess(user, fieldAuth);
        if (!hasAccess) {
          this.logger.debug(
            `Unauthorized field access: ${info.parentType.name}.${info.fieldName}`,
          );
          return null;
        }
      },
    };
  }

  private extractFieldAuth(info: any): FieldAuthOptions | undefined {
    const node = info?.fieldNode;
    if (!node?.extensions?.[FIELD_AUTH_KEY]) return undefined;
    return node.extensions[FIELD_AUTH_KEY] as FieldAuthOptions;
  }

  private async checkAccess(
    user: { id: string; roles?: string[] },
    auth: FieldAuthOptions,
  ): Promise<boolean> {
    if (auth.roles?.length) {
      const hasRole = auth.roles.some((role) => user.roles?.includes(role));
      if (!hasRole) return false;
    }

    if (auth.permissions?.length) {
      const result = await this.permissionChecker.checkPermissions({
        userId: user.id,
        permissions: auth.permissions,
      });
      return auth.requireAll ? result.hasPermission : result.grantedPermissions.length > 0;
    }

    return true;
  }
}