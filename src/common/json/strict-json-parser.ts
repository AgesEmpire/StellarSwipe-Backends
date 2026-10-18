/**
 * Thrown by `parseJsonRejectingDuplicateKeys` when the same key appears
 * more than once in a single JSON object literal.
 *
 * `JSON.parse` silently keeps only the last occurrence of a duplicate key.
 * That's exactly the ambiguity an attacker can exploit when two different
 * readers of the same payload (e.g. a signature/validation step vs. the
 * handler that actually executes the action, or a human reviewer vs. the
 * code that runs) can be made to disagree about which of two values "the"
 * key actually holds.
 */
export class DuplicateJsonKeyError extends Error {
  constructor(
    public readonly key: string,
    public readonly path: string,
  ) {
    super(`Duplicate JSON key "${key}" at "${path || '$'}"`);
    this.name = 'DuplicateJsonKeyError';
  }
}

/**
 * Parses a JSON document much like `JSON.parse` does, except an object
 * literal that repeats the same key is rejected instead of silently
 * resolving to its last occurrence.
 *
 * `JSON.parse` can't be reused for this even with a `reviver`: by the time
 * a reviver runs, duplicate keys have already been collapsed inside the
 * engine's native parser, so the ambiguity is gone before any JS code sees
 * it. This is a small, dependency-free recursive-descent parser instead.
 *
 * It is deliberately strict about well-formedness (so malformed input
 * fails closed, not open) but is not a spec-perfect reimplementation of
 * `JSON.parse` — it only needs to re-validate payloads a standards-
 * compliant `JSON.parse` has already accepted, for the one extra property
 * `JSON.parse` can't check: key uniqueness.
 */
export function parseJsonRejectingDuplicateKeys(text: string): unknown {
  const parser = new StrictJsonParser(text);
  const value = parser.parseValue('$');
  parser.skipWhitespace();
  if (parser.position !== text.length) {
    throw new SyntaxError(`Unexpected trailing content at position ${parser.position}`);
  }
  return value;
}

class StrictJsonParser {
  position = 0;

  constructor(private readonly text: string) {}

  parseValue(path: string): unknown {
    this.skipWhitespace();
    const ch = this.text[this.position];
    if (ch === '{') return this.parseObject(path);
    if (ch === '[') return this.parseArray(path);
    if (ch === '"') return this.parseString();
    if (ch === '-' || this.isDigit(ch)) return this.parseNumber();
    if (this.text.startsWith('true', this.position)) {
      this.position += 4;
      return true;
    }
    if (this.text.startsWith('false', this.position)) {
      this.position += 5;
      return false;
    }
    if (this.text.startsWith('null', this.position)) {
      this.position += 4;
      return null;
    }
    throw new SyntaxError(`Unexpected token at position ${this.position}`);
  }

  private parseObject(path: string): Record<string, unknown> {
    this.expect('{');
    const result: Record<string, unknown> = {};
    const seenKeys = new Set<string>();

    this.skipWhitespace();
    if (this.text[this.position] === '}') {
      this.position++;
      return result;
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.skipWhitespace();
      const key = this.parseString();
      if (seenKeys.has(key)) {
        throw new DuplicateJsonKeyError(key, path);
      }
      seenKeys.add(key);

      this.skipWhitespace();
      this.expect(':');

      const childPath = path === '$' ? key : `${path}.${key}`;
      result[key] = this.parseValue(childPath);

      this.skipWhitespace();
      const next = this.text[this.position];
      if (next === ',') {
        this.position++;
        continue;
      }
      if (next === '}') {
        this.position++;
        break;
      }
      throw new SyntaxError(`Expected ',' or '}' at position ${this.position}`);
    }

    return result;
  }

  private parseArray(path: string): unknown[] {
    this.expect('[');
    const result: unknown[] = [];

    this.skipWhitespace();
    if (this.text[this.position] === ']') {
      this.position++;
      return result;
    }

    let index = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      result.push(this.parseValue(`${path}[${index}]`));
      index++;

      this.skipWhitespace();
      const next = this.text[this.position];
      if (next === ',') {
        this.position++;
        continue;
      }
      if (next === ']') {
        this.position++;
        break;
      }
      throw new SyntaxError(`Expected ',' or ']' at position ${this.position}`);
    }

    return result;
  }

  private parseString(): string {
    this.skipWhitespace();
    this.expect('"');
    let result = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const ch = this.text[this.position];
      if (ch === undefined) {
        throw new SyntaxError('Unterminated string');
      }
      if (ch === '"') {
        this.position++;
        break;
      }
      if (ch === '\\') {
        this.position++;
        const esc = this.text[this.position];
        switch (esc) {
          case '"':
            result += '"';
            break;
          case '\\':
            result += '\\';
            break;
          case '/':
            result += '/';
            break;
          case 'b':
            result += '\b';
            break;
          case 'f':
            result += '\f';
            break;
          case 'n':
            result += '\n';
            break;
          case 'r':
            result += '\r';
            break;
          case 't':
            result += '\t';
            break;
          case 'u': {
            const hex = this.text.slice(this.position + 1, this.position + 5);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new SyntaxError(`Invalid unicode escape at position ${this.position}`);
            }
            result += String.fromCharCode(parseInt(hex, 16));
            this.position += 4;
            break;
          }
          default:
            throw new SyntaxError(`Invalid escape character at position ${this.position}`);
        }
        this.position++;
        continue;
      }
      result += ch;
      this.position++;
    }

    return result;
  }

  private parseNumber(): number {
    const start = this.position;
    if (this.text[this.position] === '-') this.position++;
    while (this.isDigit(this.text[this.position])) this.position++;
    if (this.text[this.position] === '.') {
      this.position++;
      while (this.isDigit(this.text[this.position])) this.position++;
    }
    if (this.text[this.position] === 'e' || this.text[this.position] === 'E') {
      this.position++;
      if (this.text[this.position] === '+' || this.text[this.position] === '-') this.position++;
      while (this.isDigit(this.text[this.position])) this.position++;
    }
    const raw = this.text.slice(start, this.position);
    if (!raw || raw === '-') {
      throw new SyntaxError(`Invalid number at position ${start}`);
    }
    return Number(raw);
  }

  private isDigit(ch: string | undefined): boolean {
    return ch !== undefined && ch >= '0' && ch <= '9';
  }

  private expect(ch: string): void {
    if (this.text[this.position] !== ch) {
      throw new SyntaxError(`Expected "${ch}" at position ${this.position}`);
    }
    this.position++;
  }

  skipWhitespace(): void {
    while (this.position < this.text.length && /\s/.test(this.text[this.position])) {
      this.position++;
    }
  }
}
