//! StellarSwipe Trade Executor Soroban Contract
//!
//! Provides on-chain trade execution primitives:
//!   - execute_market_order  — executes a market order at the current price
//!   - place_limit_order     — places a limit order at a specified price
//!   - cancel_order          — cancels an open limit order
//!   - get_order             — retrieves an order by ID
//!   - withdraw_consent      — withdraws optional data-processing consent
//!   - has_consent           — reports whether optional consent is active
//!
//! State is stored per-contract via Soroban's persistent ledger storage.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short,
    Address, Env, Map, String, Symbol,
};

// ── Storage keys ──────────────────────────────────────────────────────────────

const ORDERS_KEY: Symbol = symbol_short!("ORDERS");
const ORDER_COUNT_KEY: Symbol = symbol_short!("COUNT");
const CONTRACT_VERSION_KEY: Symbol = symbol_short!("CVER");
const CONSENT_KEY: Symbol = symbol_short!("CONSENT");

/// Interface version this contract implements. Entrypoints that require a
/// specific interface reject deployed contracts whose metadata does not match.
pub const INTERFACE_VERSION: u32 = 1;

/// Maximum number of contract-version metadata entries kept in the bounded
/// cache. Prevents unbounded growth of persistent storage.
const MAX_VERSION_CACHE_ENTRIES: u32 = 32;

// ── Data types ────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum OrderStatus {
    Open,
    Filled,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Order {
    pub id: u64,
    pub user: Address,
    pub base_asset: Symbol,
    pub counter_asset: Symbol,
    /// Amount in stroops (1 XLM = 10_000_000 stroops)
    pub amount: i128,
    /// Limit price in stroops; 0 for market orders
    pub limit_price: i128,
    pub side: Symbol,
    pub status: OrderStatus,
    /// Unix timestamp after which a limit order expires; 0 = no expiry
    pub expires_at: u64,
}

/// Version metadata advertised by a deployed contract.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractVersion {
    /// Interface version the deployed contract implements.
    pub interface_version: u32,
    /// Minimum interface version this contract can interoperate with.
    pub min_compatible_version: u32,
}

/// Recorded withdrawal of optional data-processing consent.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct ConsentWithdrawal {
    /// Unix timestamp at which the withdrawal was recorded.
    pub withdrawn_at: u64,
    /// Consent policy version the withdrawal applies to.
    pub consent_version: u32,
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct TradeExecutorContract;

#[contractimpl]
impl TradeExecutorContract {
    /// Execute a market order immediately.
    ///
    /// Returns the assigned order ID.
    pub fn execute_market_order(
        env: Env,
        user: Address,
        base_asset: Symbol,
        counter_asset: Symbol,
        amount: i128,
        slippage_bps: u32,
        side: Symbol,
    ) -> u64 {
        user.require_auth();

        Self::require_compatible_interface(&env);

        assert!(amount > 0, "amount must be positive");
        assert!(slippage_bps <= 1000, "slippage_bps exceeds maximum (1000)");

        let order_id = Self::next_order_id(&env);
        let order = Order {
            id: order_id,
            user: user.clone(),
            base_asset,
            counter_asset,
            amount,
            limit_price: 0,
            side,
            status: OrderStatus::Filled, // market orders fill immediately
            expires_at: 0,
        };

        Self::save_order(&env, &order);

        env.events().publish(
            (symbol_short!("TRADE"), symbol_short!("FILLED")),
            (order_id, user, amount),
        );

        order_id
    }

    /// Place a limit order (resting, not immediately filled).
    ///
    /// Returns the assigned order ID.
    pub fn place_limit_order(
        env: Env,
        user: Address,
        base_asset: Symbol,
        counter_asset: Symbol,
        amount: i128,
        limit_price: i128,
        side: Symbol,
        expires_at: u64,
    ) -> u64 {
        user.require_auth();

        Self::require_compatible_interface(&env);

        assert!(amount > 0, "amount must be positive");
        assert!(limit_price > 0, "limit_price must be positive");

        let order_id = Self::next_order_id(&env);
        let order = Order {
            id: order_id,
            user: user.clone(),
            base_asset,
            counter_asset,
            amount,
            limit_price,
            side,
            status: OrderStatus::Open,
            expires_at,
        };

        Self::save_order(&env, &order);

        env.events().publish(
            (symbol_short!("TRADE"), symbol_short!("PLACED")),
            (order_id, user, limit_price),
        );

        order_id
    }

    /// Cancel an open limit order.
    pub fn cancel_order(env: Env, user: Address, order_id: u64) {
        user.require_auth();

        Self::require_compatible_interface(&env);

        let mut order = Self::load_order(&env, order_id);
        assert!(order.user == user, "not order owner");
        assert!(
            order.status == OrderStatus::Open,
            "order is not open"
        );

        order.status = OrderStatus::Cancelled;
        Self::save_order(&env, &order);

        env.events().publish(
            (symbol_short!("TRADE"), symbol_short!("CANCEL")),
            (order_id, user),
        );
    }

    /// Retrieve an order by ID.
    pub fn get_order(env: Env, order_id: u64) -> Order {
        Self::load_order(&env, order_id)
    }

    /// Withdraw optional data-processing consent for `user`.
    ///
    /// Records the withdrawal with the current ledger timestamp and the
    /// supplied consent policy version. Duplicate requests are idempotent:
    /// the first recorded withdrawal is preserved and no additional event is
    /// emitted, so dependent backend workflows observe a single transition.
    pub fn withdraw_consent(env: Env, user: Address, consent_version: u32) {
        user.require_auth();

        Self::require_compatible_interface(&env);

        let mut consents: Map<Address, ConsentWithdrawal> = env
            .storage()
            .persistent()
            .get(&CONSENT_KEY)
            .unwrap_or_else(|| Map::new(&env));

        // Idempotent: a withdrawal already on record is a no-op.
        if consents.contains_key(user.clone()) {
            return;
        }

        let withdrawal = ConsentWithdrawal {
            withdrawn_at: env.ledger().timestamp(),
            consent_version,
        };
        consents.set(user.clone(), withdrawal.clone());
        env.storage().persistent().set(&CONSENT_KEY, &consents);

        // Propagate the withdrawal so dependent processing can react.
        env.events().publish(
            (symbol_short!("CONSENT"), symbol_short!("WITHDRAW")),
            (user, withdrawal.withdrawn_at, withdrawal.consent_version),
        );
    }

    /// Returns true when `user` has NOT withdrawn optional consent, i.e. the
    /// dependent backend processing may still rely on it.
    pub fn has_consent(env: Env, user: Address) -> bool {
        let consents: Map<Address, ConsentWithdrawal> = env
            .storage()
            .persistent()
            .get(&CONSENT_KEY)
            .unwrap_or_else(|| Map::new(&env));
        !consents.contains_key(user)
    }

    /// Retrieve the recorded consent withdrawal for `user`, if any.
    pub fn get_consent_withdrawal(env: Env, user: Address) -> Option<ConsentWithdrawal> {
        let consents: Map<Address, ConsentWithdrawal> = env
            .storage()
            .persistent()
            .get(&CONSENT_KEY)
            .unwrap_or_else(|| Map::new(&env));
        consents.get(user)
    }

    /// Register the interface version metadata for this deployed contract.
    ///
    /// The cache is bounded: once `MAX_VERSION_CACHE_ENTRIES` distinct
    /// contracts have been recorded, the oldest entry is evicted.
    pub fn set_contract_version(
        env: Env,
        contract: Address,
        interface_version: u32,
        min_compatible_version: u32,
    ) {
        contract.require_auth();

        let mut cache: Map<Address, ContractVersion> = env
            .storage()
            .persistent()
            .get(&CONTRACT_VERSION_KEY)
            .unwrap_or_else(|| Map::new(&env));

        if !cache.contains_key(contract.clone()) && cache.len() >= MAX_VERSION_CACHE_ENTRIES {
            // Evict the first (oldest) entry to keep the cache bounded.
            if let Some(oldest) = cache.keys().first() {
                cache.remove(oldest);
            }
        }

        cache.set(
            contract,
            ContractVersion {
                interface_version,
                min_compatible_version,
            },
        );
        env.storage().persistent().set(&CONTRACT_VERSION_KEY, &cache);
    }

    /// Read the cached version metadata for a deployed contract, if any.
    pub fn get_contract_version(env: Env, contract: Address) -> Option<ContractVersion> {
        let cache: Map<Address, ContractVersion> = env
            .storage()
            .persistent()
            .get(&CONTRACT_VERSION_KEY)
            .unwrap_or_else(|| Map::new(&env));
        cache.get(contract)
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /// Verify that the deployed contract's version metadata is compatible with
    /// the interface required by this entrypoint. Fails with a clear internal
    /// error when the contract is unsupported or metadata is missing.
    fn require_compatible_interface(env: &Env) {
        let cache: Map<Address, ContractVersion> = env
            .storage()
            .persistent()
            .get(&CONTRACT_VERSION_KEY)
            .unwrap_or_else(|| Map::new(env));

        let version = cache
            .get(env.current_contract_address())
            .expect("contract version metadata missing: unsupported contract");

        assert!(
            version.interface_version >= version.min_compatible_version,
            "contract version metadata inconsistent: unsupported contract"
        );
        assert!(
            version.interface_version == INTERFACE_VERSION,
            "unsupported contract interface version"
        );
    }

    fn next_order_id(env: &Env) -> u64 {
        let count: u64 = env
            .storage()
            .persistent()
            .get(&ORDER_COUNT_KEY)
            .unwrap_or(0);
        let next = count + 1;
        env.storage().persistent().set(&ORDER_COUNT_KEY, &next);
        next
    }

    fn save_order(env: &Env, order: &Order) {
        let mut orders: Map<u64, Order> = env
            .storage()
            .persistent()
            .get(&ORDERS_KEY)
            .unwrap_or_else(|| Map::new(env));
        orders.set(order.id, order.clone());
        env.storage().persistent().set(&ORDERS_KEY, &orders);
    }

    fn load_order(env: &Env, order_id: u64) -> Order {
        let orders: Map<u64, Order> = env
            .storage()
            .persistent()
            .get(&ORDERS_KEY)
            .unwrap_or_else(|| Map::new(env));
        orders.get(order_id).expect("order not found")
    }
}
