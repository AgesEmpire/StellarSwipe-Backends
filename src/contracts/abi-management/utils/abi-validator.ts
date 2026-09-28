export interface AbiEntry {
  type: string;
  name?: string;
  inputs?: Array<Record<string, unknown>>;
  outputs?: Array<Record<string, unknown>>;
  stateMutability?: string;
  anonymous?: boolean;
}

export function parseAbiPayload(abi: unknown): AbiEntry[] {
  const parsed = typeof abi === 'string' ? JSON.parse(abi) : abi;

  if (!Array.isArray(parsed)) {
    throw new Error('ABI must be a JSON array');
  }

  parsed.forEach((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`ABI entry at index ${index} must be an object`);
    }

    if (typeof (item as AbiEntry).type !== 'string' || !(item as AbiEntry).type) {
      throw new Error(`ABI entry at index ${index} is missing required field "type"`);
    }
  });

  return parsed as AbiEntry[];
}

export function canonicalizeAbi(abi: AbiEntry[]): string {
  return JSON.stringify(
    abi.map((entry) => {
      const normalized: Record<string, unknown> = {};
      for (const key of Object.keys(entry).sort()) {
        const value = (entry as Record<string, unknown>)[key];
        normalized[key] = Array.isArray(value)
          ? value.map((item) =>
              item && typeof item === 'object' ? sortObject(item as Record<string, unknown>) : item,
            )
          : value && typeof value === 'object'
            ? sortObject(value as Record<string, unknown>)
            : value;
      }
      return normalized;
    }),
  );
}

function sortObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.keys(value)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      const item = value[key];
      acc[key] =
        item && typeof item === 'object' && !Array.isArray(item)
          ? sortObject(item as Record<string, unknown>)
          : item;
      return acc;
    }, {});
}
