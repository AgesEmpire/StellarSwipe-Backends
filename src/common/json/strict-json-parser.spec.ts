import { DuplicateJsonKeyError, parseJsonRejectingDuplicateKeys } from './strict-json-parser';

describe('parseJsonRejectingDuplicateKeys', () => {
  it('parses ordinary JSON the same way JSON.parse does', () => {
    const payloads = [
      '{}',
      '[]',
      '{"a":1,"b":[1,2,3],"c":{"d":true,"e":null},"f":"text with \\"quotes\\" and \\n newline"}',
      '"a bare string"',
      '42',
      '-3.14e10',
      'true',
      'false',
      'null',
      '{"nested":{"deeply":{"array":[1,2,{"x":1}]}}}',
    ];

    for (const payload of payloads) {
      expect(parseJsonRejectingDuplicateKeys(payload)).toEqual(JSON.parse(payload));
    }
  });

  it('rejects a top-level object with a duplicate key', () => {
    expect(() => parseJsonRejectingDuplicateKeys('{"amount":100,"amount":1}')).toThrow(
      DuplicateJsonKeyError,
    );
  });

  it('rejects a duplicate key nested inside an array of objects', () => {
    expect(() =>
      parseJsonRejectingDuplicateKeys('{"items":[{"id":1},{"id":2,"id":3}]}'),
    ).toThrow(DuplicateJsonKeyError);
  });

  it('rejects a duplicate key nested inside a nested object', () => {
    expect(() =>
      parseJsonRejectingDuplicateKeys('{"user":{"role":"user","role":"admin"}}'),
    ).toThrow(DuplicateJsonKeyError);
  });

  it('does not flag the same key name reused at different nesting levels', () => {
    expect(() =>
      parseJsonRejectingDuplicateKeys('{"id":1,"nested":{"id":2}}'),
    ).not.toThrow();
  });

  it('reports which key was duplicated', () => {
    try {
      parseJsonRejectingDuplicateKeys('{"role":"user","role":"admin"}');
      fail('expected parseJsonRejectingDuplicateKeys to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(DuplicateJsonKeyError);
      expect((error as DuplicateJsonKeyError).key).toBe('role');
    }
  });

  it('throws a plain SyntaxError for malformed JSON, not a duplicate-key error', () => {
    expect(() => parseJsonRejectingDuplicateKeys('{not valid json')).toThrow(SyntaxError);
    try {
      parseJsonRejectingDuplicateKeys('{not valid json');
    } catch (error) {
      expect(error).not.toBeInstanceOf(DuplicateJsonKeyError);
    }
  });

  it('rejects trailing content after a valid value', () => {
    expect(() => parseJsonRejectingDuplicateKeys('{"a":1} extra')).toThrow(SyntaxError);
  });
});
