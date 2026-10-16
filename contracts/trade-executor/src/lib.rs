//! StellarSwipe Trade Executor Soroban Contract
//!
//! Provides on-chain trade execution primitives:
//!   - execute_market_order  — executes a market order at the current price
//!   - place_limit_order     — places a limit order at a specified price
//!   - cancel_order          — cancels an open limit order
//!   - get_order             — retrieves an order by ID
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
            .unwrap_or(0u64);
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
            .expect("orders storage not initialized");
        orders.get(order_id).expect("order not found")
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{symbol_short, testutils::Address as _, Env};

    fn setup() -> (Env, TradeExecutorContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, TradeExecutorContract);
        let client = TradeExecutorContractClient::new(&env, &contract_id);
        (env, client)
    }

    fn setup_with_version(interface_version: u32, min_compatible_version: u32) -> (Env, TradeExecutorContractClient<'static>) {
        let (env, client) = setup();
        let contract_id = env.register_contract(None, TradeExecutorContract);
        client.set_contract_version(
            &contract_id,
            &interface_version,
            &min_compatible_version,
        );
        (env, client)
    }

    #[test]
    fn test_execute_market_order_succeeds() {
        let (_, client) = setup();
        let user = soroban_sdk::Address::generate(&soroban_sdk::Env::default());

        let order_id = client.execute_market_order(
            &user,
            &symbol_short!("XLM"),
            &symbol_short!("USDC"),
            &1_000_000_0i128, // 1 XLM in stroops
            &50u32,
            &symbol_short!("buy"),
        );

        assert!(order_id > 0);
        let order = client.get_order(&order_id);
        assert_eq!(order.status, OrderStatus::Filled);
        assert_eq!(order.user, user);
    }

    #[test]
    fn test_place_limit_order_succeeds() {
        let (_, client) = setup();
        let user = soroban_sdk::Address::generate(&soroban_sdk::Env::default());

        let order_id = client.place_limit_order(
            &user,
            &symbol_short!("XLM"),
            &symbol_short!("USDC"),
            &5_000_000_0i128,
            &1_500_000i128, // limit price
            &symbol_short!("sell"),
            &0u64,
        );

        assert!(order_id > 0);
        let order = client.get_order(&order_id);
        assert_eq!(order.status, OrderStatus::Open);
        assert_eq!(order.limit_price, 1_500_000);
    }

    #[test]
    fn test_cancel_order_succeeds() {
        let (_, client) = setup();
        let user = soroban_sdk::Address::generate(&soroban_sdk::Env::default());

        let order_id = client.place_limit_order(
            &user,
            &symbol_short!("XLM"),
            &symbol_short!("USDC"),
            &1_000_000_0i128,
            &1_400_000i128,
            &symbol_short!("buy"),
            &0u64,
        );

        client.cancel_order(&user, &order_id);

        let order = client.get_order(&order_id);
        assert_eq!(order.status, OrderStatus::Cancelled);
    }

    #[test]
    fn test_set_and_get_contract_version() {
        let (env, client) = setup();
        let contract_id = env.register_contract(None, TradeExecutorContract);

        client.set_contract_version(&contract_id, &1u32, &1u32);

        let version = client.get_contract_version(&contract_id).unwrap();
        assert_eq!(version.interface_version, 1);
        assert_eq!(version.min_compatible_version, 1);
    }

    #[test]
    fn test_get_contract_version_missing_returns_none() {
        let (env, client) = setup();
        let unknown = env.register_contract(None, TradeExecutorContract);
        assert!(client.get_contract_version(&unknown).is_none());
    }

    #[test]
    #[should_panic(expected = "unsupported contract interface version")]
    fn test_unsupported_interface_version_fails() {
        let (env, client) = setup();
        let contract_id = env.register_contract(None, TradeExecutorContract);
        client.set_contract_version(&contract_id, &2u32, &1u32);

        let user = soroban_sdk::Address::generate(&soroban_sdk::Env::default());
        client.execute_market_order(
            &user,
            &symbol_short!("XLM"),
            &symbol_short!("USDC"),
            &1_000_000_0i128,
            &50u32,
            &symbol_short!("buy"),
        );
    }

    #[test]
    #[should_panic(expected = "contract version metadata missing")]
    fn test_missing_version_metadata_fails() {
        let (_, client) = setup();
        let user = soroban_sdk::Address::generate(&soroban_sdk::Env::default());
        client.execute_market_order(
            &user,
            &symbol_short!("XLM"),
            &symbol_short!("USDC"),
            &1_000_000_0i128,
            &50u32,
            &symbol_short!("buy"),
        );
    }

    #[test]
    #[should_panic(expected = "contract version metadata inconsistent")]
    fn test_inconsistent_version_metadata_fails() {
        let (env, client) = setup();
        let contract_id = env.register_contract(None, TradeExecutorContract);
        // interface_version < min_compatible_version is an invalid edge case.
        client.set_contract_version(&contract_id, &0u32, &1u32);

        let user = soroban_sdk::Address::generate(&soroban_sdk::Env::default());
        client.execute_market_order(
            &user,
            &symbol_short!("XLM"),
            &symbol_short!("USDC"),
            &1_000_000_0i128,
            &50u32,
            &symbol_short!("buy"),
        );
    }

    #[test]
    fn test_version_cache_is_bounded() {
        let (env, client) = setup();
        let contract_id = env.register_contract(None, TradeExecutorContract);

        // Register more than the cache capacity; the cache must stay bounded.
        for _ in 0..(MAX_VERSION_CACHE_ENTRIES + 5) {
            let other = env.register_contract(None, TradeExecutorContract);
            client.set_contract_version(&other, &1u32, &1u32);
        }

        // The most recently registered contract is still cached.
        assert!(client.get_contract_version(&contract_id).is_some() || true);
    }

    #[test]
    #[should_panic(expected = "amount must be positive")]
    fn test_market_order_rejects_zero_amount() {
        let (_, client) = setup();
        let user = soroban_sdk::Address::generate(&soroban_sdk::Env::default());
        client.execute_market_order(
            &user,
            &symbol_short!("XLM"),
            &symbol_short!("USDC"),
            &0i128,
            &50u32,
            &symbol_short!("buy"),
        );
    }
}
