# Low wallet balance alerts

The low-balance alert feature has two entry points:

* Trading flows can call `LowBalanceAlertService.checkAndAlert` immediately
  after reading a wallet balance. This gives the user feedback at the moment
  a trade cannot be funded.
* `LowBalanceAlertJob` scans active users with connected Stellar wallets every
  five minutes. This catches balances reduced by an external transaction and
  does not require the user to attempt another trade.

The threshold is configured as `trade.minimumBalanceThreshold` and defaults to
10 XLM. A balance equal to the threshold is considered sufficient. Invalid or
negative values are ignored rather than being converted into an alert.

An alert includes the wallet address, current balance, threshold, shortfall,
and a conservative estimated trade capacity after the configured base fee.
The in-app notification is a system alert, not a marketing message, so it is
not suppressed by marketing consent settings.

## Cooldown and failure behavior

Alerts are deduplicated per user through the shared cache. The default cooldown
is 24 hours and is configured by `alerts.lowBalanceCooldownSeconds`. A cache
hit suppresses the notification but still returns a `cooldown_active` result
to the caller. A sufficient balance does not create or refresh a cooldown.

The scheduled scan isolates provider failures per wallet. A Horizon error for
one user is logged and counted, while the remaining wallets continue to be
checked. The service also avoids creating an alert for a malformed provider
response. This keeps network failures from turning into misleading user
notifications.

The module imports the shared cache, notifications, Stellar account, and user
repository dependencies. It can therefore be enabled from `AppModule` without
manual provider registration. The scheduler uses UTC and is safe to run on
multiple application instances because the cache cooldown suppresses repeated
user notifications across instances.
