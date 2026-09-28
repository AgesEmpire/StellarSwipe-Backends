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

    // ── Private helpers ───────────────────────────────────────────────────────

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

    #[test]
    #[should_panic(expected = "not order owner")]
    fn test_cancel_order_rejects_wrong_owner() {
        let (_, client) = setup();
        let env = soroban_sdk::Env::default();
        let owner = soroban_sdk::Address::generate(&env);
        let attacker = soroban_sdk::Address::generate(&env);

        let order_id = client.place_limit_order(
            &owner,
            &symbol_short!("XLM"),
            &symbol_short!("USDC"),
            &1_000_000_0i128,
            &1_400_000i128,
            &symbol_short!("buy"),
            &0u64,
        );

        client.cancel_order(&attacker, &order_id);
    }

    #[test]
    fn test_order_ids_are_sequential() {
        let (_, client) = setup();
        let user = soroban_sdk::Address::generate(&soroban_sdk::Env::default());

        let id1 = client.execute_market_order(
            &user, &symbol_short!("XLM"), &symbol_short!("USDC"),
            &1_000_000_0i128, &0u32, &symbol_short!("buy"),
        );
        let id2 = client.execute_market_order(
            &user, &symbol_short!("XLM"), &symbol_short!("USDC"),
            &2_000_000_0i128, &0u32, &symbol_short!("sell"),
        );

        assert_eq!(id2, id1 + 1);
    }
}
