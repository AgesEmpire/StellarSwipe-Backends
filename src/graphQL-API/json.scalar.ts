import { Scalar, CustomScalar } from '@nestjs/graphql';
import { Kind, ValueNode } from 'graphql';

type JsonValue = string | number | boolean | null | JsonObject | JsonArray;
type JsonObject = { [key: string]: JsonValue };
type JsonArray = JsonValue[];

function parseLiteralToJson(ast: ValueNode): JsonValue {
  switch (ast.kind) {
    case Kind.STRING:
      return ast.value;
    case Kind.BOOLEAN:
      return ast.value;
    case Kind.INT:
      return parseInt(ast.value, 10);
    case Kind.FLOAT:
      return parseFloat(ast.value);
    case Kind.NULL:
      return null;
    case Kind.LIST:
      return ast.values.map(parseLiteralToJson);
    case Kind.OBJECT:
      return ast.fields.reduce<JsonObject>((acc, field) => {
        acc[field.name.value] = parseLiteralToJson(field.value);
        return acc;
      }, {});
    default:
      throw new Error(`JSONScalar: unsupported literal kind "${ast.kind}"`);
  }
}

@Scalar('JSON', () => Object)
export class JsonScalar implements CustomScalar<JsonValue, JsonValue> {
  description =
    'JSON scalar — accepts any valid JSON value (object, array, string, number, boolean, null)';

  serialize(value: unknown): JsonValue {
    return value as JsonValue;
  }

  parseValue(value: unknown): JsonValue {
    return value as JsonValue;
  }

  parseLiteral(ast: ValueNode): JsonValue {
    return parseLiteralToJson(ast);
  }
}
