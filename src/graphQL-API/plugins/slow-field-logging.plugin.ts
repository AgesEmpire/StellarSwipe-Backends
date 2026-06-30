import {
  ApolloServerPlugin,
  GraphQLRequestContext,
  GraphQLRequestListener,
} from '@apollo/server';
import { Logger } from '@nestjs/common';
import { Plugin } from '@nestjs/apollo';
import { ConfigService } from '@nestjs/config';

interface FieldResolution {
  parentType: string;
  fieldName: string;
  startTime: number;
}

interface RequestContext {
  fieldStack?: FieldResolution[];
}

@Plugin()
export class SlowFieldLoggingPlugin implements ApolloServerPlugin<RequestContext> {
  private readonly logger = new Logger('GraphQL.SlowFields');
  private readonly thresholdMs: number;

  constructor(configService: ConfigService) {
    this.thresholdMs = configService.get<number>('GRAPHQL_SLOW_FIELD_THRESHOLD_MS') ?? 500;
  }

  async requestDidStart(
    requestContext: GraphQLRequestContext<RequestContext>,
  ): Promise<GraphQLRequestListener<RequestContext>> {
    const { context } = requestContext;
    context.fieldStack = [];

    return {
      async willResolveField(fieldContext: any) {
        const { info } = fieldContext;
        const startTime = Date.now();

        const fieldResolution: FieldResolution = {
          parentType: info.parentType.name,
          fieldName: info.fieldName,
          startTime,
        };

        context.fieldStack!.push(fieldResolution);

        return async (error: any, result: any) => {
          context.fieldStack!.pop();
          const duration = Date.now() - startTime;

          if (duration > this.thresholdMs) {
            this.logger.warn(
              `Slow field resolution: ${fieldResolution.parentType}.${fieldResolution.fieldName} [${duration}ms]`,
            );
          }

          return result;
        };
      },
    };
  }
}
