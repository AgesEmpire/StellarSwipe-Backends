# Shared Validation Strategy

## Why

Validation rules were previously applied ad hoc: some DTOs and GraphQL
inputs had length limits and enum checks, others didn't (see
`SignalFilterInput.createdAfter` / `expiresBeforeI`, which had no validator
at all before this change). That makes API behavior inconsistent — one
endpoint rejects an over-long string, another silently accepts it — and
means the same "nullable + bounded + enum" pattern gets re-derived by hand
in every new DTO.

## What's centralized

`src/common/validation/constraints/common-constraints.decorators.ts` provides
composed decorators for the constraints that recur everywhere:

- `NullableString(maxLength, minLength?)` / `BoundedString(min, max)`
- `NullableBoundedNumber(min, max)` / `BoundedNumber(min, max)`
- `NullableEnum(enumType)` / `RequiredEnum(enumType)`
- `NullableIsoDate()`

Use these instead of hand-rolling `@IsOptional() @IsString() @MaxLength(n)`
combinations on new DTOs and GraphQL input types.

`src/common/validation/validation-error-formatter.ts` holds the single
implementation of "class-validator errors -> `{ field: [messages] }`",
shared by both `CustomValidationPipe` (the global `APP_PIPE` used for
controller/resolver arguments) and `ValidationStrategyService` — so every
validation failure, wherever it's triggered, produces the same
`{ message: 'Validation failed', errors: {...} }` shape.

## Where to use `ValidationStrategyService`

`CustomValidationPipe` runs automatically for any controller or resolver
argument typed as a class-validator-decorated class — most DTOs and GraphQL
inputs don't need anything extra.

Inject `ValidationStrategyService` when validation needs to happen somewhere
the automatic pipe doesn't reach: an ad-hoc/dynamic payload (e.g. a JSON
scalar field), or a DTO a service builds up internally before persisting it.

```ts
constructor(private readonly validation: ValidationStrategyService) {}

async handle(rawPayload: unknown) {
  const dto = await this.validation.validate(MyDto, rawPayload); // throws BadRequestException on failure
  // or, to avoid throwing:
  const { valid, errors, value } = await this.validation.safeValidate(MyDto, rawPayload);
}
```

## Example

`src/graphQL-API/inputs/signal-filter.input.ts` was updated to use these
decorators as the reference implementation, and gained validation on
`createdAfter`/`expiresBeforeI` (previously unvalidated free-form strings)
via `NullableIsoDate()`.

## Machine-readable validation errors

Validation failures from `CustomValidationPipe` and `ValidationStrategyService`
include a `violations` array next to the existing `errors`/`details` fields.
Each entry is one failed rule:

```json
{
  "message": "Validation failed",
  "error": "Validation",
  "code": "V1001",
  "details": { "items": { "0": { "name": ["name must be a string"] } } },
  "violations": [
    { "field": "items.0.name", "rule": "isString", "message": "name must be a string" }
  ]
}
```

- `field` is the dot-separated path to the property. Array items use their
  index (`items.0.name`); nested DTOs use their property chain (`address.zip`).
- `rule` is the stable identifier. It is the class-validator constraint name
  (the key of `ValidationError.constraints`), so it does not change with the
  message text or the request locale. Clients should branch on `rule`, not on
  `message`.
- `message` is human-readable only and may be localized or reworded.
- `code` remains `V1001` (`INVALID_INPUT`) for every validation failure, and
  the HTTP status is unchanged (400).

### Rule identifiers from the shared constraint decorators

| Decorator | Rule identifiers emitted |
|---|---|
| `NullableString(max, min?)` | `isString`, `minLength`, `maxLength` (`IsOptional` emits no rule) |
| `BoundedString(min, max)` | `isString`, `minLength`, `maxLength` |
| `NullableBoundedNumber(min, max)` | `isNumber`, `min`, `max` |
| `BoundedNumber(min, max)` | `isNumber`, `min`, `max` |
| `NullableEnum(enum)` / `RequiredEnum(enum)` | `isEnum` |
| `NullableIsoDate()` | `isIso8601` |

Rules added by the global pipe itself:

| Source | Rule identifier |
|---|---|
| Property not declared on the DTO (`forbidNonWhitelisted`) | `whitelistValidation` |

Other class-validator decorators use their constraint name, which is the
decorator name in lowerCamelCase (for example `@IsNotEmpty()` emits
`isNotEmpty`, `@ArrayMinSize()` emits `arrayMinSize`). Constraint names are
defined by the pinned `class-validator` version (`^0.14.0`). Check the name
against that version before relying on it in a client.

### Compatibility

Existing fields (`message`, `error`, `code`, `details`, and `errors` from
`ValidationStrategyService`) are unchanged. `violations` is additive, so
clients that ignore unknown fields need no change.
