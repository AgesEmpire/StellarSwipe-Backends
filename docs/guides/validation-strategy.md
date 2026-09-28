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
