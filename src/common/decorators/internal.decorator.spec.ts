import { Internal, getInternalFields, INTERNAL_FIELD_KEY } from './internal.decorator';

describe('Internal Decorator', () => {
  it('should mark a field as internal', () => {
    class TestEntity {
      id: string;

      @Internal()
      secretField: string;
    }

    const instance = new TestEntity();
    const internalFields = getInternalFields(instance);

    expect(internalFields).toContain('secretField');
  });

  it('should mark multiple fields as internal', () => {
    class TestEntity {
      id: string;

      @Internal()
      riskScore: number;

      @Internal()
      internalFlag: boolean;

      publicField: string;
    }

    const instance = new TestEntity();
    const internalFields = getInternalFields(instance);

    expect(internalFields).toContain('riskScore');
    expect(internalFields).toContain('internalFlag');
    expect(internalFields).not.toContain('publicField');
    expect(internalFields).not.toContain('id');
  });

  it('should not mark non-decorated fields as internal', () => {
    class TestEntity {
      @Internal()
      internal: string;

      public: string;
    }

    const instance = new TestEntity();
    const internalFields = getInternalFields(instance);

    expect(internalFields).toHaveLength(1);
    expect(internalFields[0]).toBe('internal');
  });

  it('should return empty array for objects without internal fields', () => {
    class PlainEntity {
      id: string;
      name: string;
    }

    const instance = new PlainEntity();
    const internalFields = getInternalFields(instance);

    expect(internalFields).toEqual([]);
  });

  it('should handle null and undefined gracefully', () => {
    expect(getInternalFields(null)).toEqual([]);
    expect(getInternalFields(undefined)).toEqual([]);
  });

  it('should handle non-object types gracefully', () => {
    expect(getInternalFields('string')).toEqual([]);
    expect(getInternalFields(123)).toEqual([]);
    expect(getInternalFields(true)).toEqual([]);
  });
});
