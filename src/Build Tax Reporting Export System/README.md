# Tax reporting

`TaxReportService.generateReport` uses only ledger entries with status
`finalized`. Pending, reversed, corrected, and any other non-final states are
excluded. The included and excluded states, along with the exact rule, are
recorded in report metadata. Finalized transactions are ordered by sale date
and ledger-entry ID for stable output.

Before generating a report, register a jurisdiction configuration and tax
mapping set through `TaxReportConfigurationService`. Both use ISO date-only
effective boundaries with an inclusive `effectiveFrom` and exclusive
`effectiveTo`. A configuration and mapping set must cover the entire calendar
tax year; overlapping periods are rejected. Each report records the selected
jurisdiction-configuration version and mapping version, and its transactions
retain their classifications.

This feature currently keeps configuration and ledger data in memory. A
production deployment should replace these registries with durable repositories
while preserving the same effective-date and finalized-entry policies.
