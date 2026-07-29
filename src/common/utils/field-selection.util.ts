import { BadRequestException } from '@nestjs/common';

export function parseFields(fields?: string): string[] {
  if (!fields || !fields.trim()) {
    return [];
  }

  return fields
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0);
}

export function applySparseFieldset<T>(value: T, fields?: string): T {
  const fieldPaths = parseFields(fields);
  if (!fieldPaths.length) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => selectFields(item, fieldPaths)) as unknown as T;
  }

  if (isArrayResponse(value, 'signals', fieldPaths)) {
    const response = value as unknown as Record<string, unknown>;
    return {
      ...response,
      signals: (response.signals as unknown[]).map((item) =>
        selectFieldsFromArrayItem(item, fieldPaths, 'signals'),
      ),
    } as T;
  }

  if (isArrayResponse(value, 'data', fieldPaths)) {
    const response = value as unknown as Record<string, unknown>;
    return {
      ...response,
      data: (response.data as unknown[]).map((item) =>
        selectFieldsFromArrayItem(item, fieldPaths, 'data'),
      ),
    } as T;
  }

  return selectFields(value as unknown as Record<string, unknown>, fieldPaths) as T;
}

function selectFields(source: unknown, fieldPaths: string[]): unknown {
  if (source === null || source === undefined || typeof source !== 'object') {
    return source;
  }

  const result: Record<string, unknown> = {};

  for (const path of fieldPaths) {
    const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
    if (!segments.length) {
      continue;
    }

    if (!hasPath(source, segments)) {
      throw new BadRequestException(`Invalid fields parameter: ${path}`);
    }

    const value = getPath(source, segments);
    setPath(result, segments, value);
  }

  return result;
}

function selectFieldsFromArrayItem(source: unknown, fieldPaths: string[], arrayKey: string): unknown {
  const normalizedFields = fieldPaths.map((path) => {
    const prefix = `${arrayKey}.`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : path;
  });

  return selectFields(source, normalizedFields);
}

function hasPath(source: unknown, segments: string[]): boolean {
  let current: any = source;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return false;
    }

    if (typeof current !== 'object' || !(segment in current)) {
      return false;
    }

    current = current[segment];
  }

  return true;
}

function getPath(source: unknown, segments: string[]): unknown {
  return segments.reduce((current: any, segment) => {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    return current[segment];
  }, source as any);
}

function setPath(target: Record<string, unknown>, segments: string[], value: unknown): void {
  let current = target;

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const nextIsLeaf = index === segments.length - 1;

    if (nextIsLeaf) {
      current[segment] = value;
      return;
    }

    if (current[segment] === undefined || current[segment] === null) {
      current[segment] = {};
    }

    if (typeof current[segment] !== 'object') {
      current[segment] = {};
    }

    current = current[segment] as Record<string, unknown>;
  }
}

function isArrayResponse(value: unknown, arrayKey: string, fieldPaths: string[]): boolean {
  if (value === null || value === undefined || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  const array = response[arrayKey];
  if (!Array.isArray(array)) {
    return false;
  }

  if (array.length === 0) {
    return true;
  }

  return fieldPaths.every((path) => {
    const normalizedPath = path.startsWith(`${arrayKey}.`) ? path.slice(arrayKey.length + 1) : path;
    const segments = normalizedPath.split('.').map((segment) => segment.trim()).filter(Boolean);
    return typeof array[0] === 'object' && array[0] !== null && hasPath(array[0], segments);
  });
}
