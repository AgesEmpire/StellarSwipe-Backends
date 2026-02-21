//! Whsper Stellar - Read-only query functions for pending claim information.
//! Designed for UI/frontend integration. No authentication required.

#![cfg_attr(target_family = "wasm", no_std)]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol, Vec,
};

/// Maximum number of claims to return per page (pagination limit).
pub const MAX_PAGE_SIZE: u32 = 100;

/// Claim status for filtering.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum ClaimStatus {
    Pending = 0,
    Claimed = 1,
    Cancelled = 2,
}

/// Configuration for claim window (when claims can be executed).
#[contracttype]
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ClaimWindowConfig {
    /// Duration in ledger seconds for the claim window.
    pub window_duration_secs: u64,
    /// Minimum time between claim window start and when a claim can be executed.
    pub min_claim_delay_secs: u64,
}

/// Pending claim data structure.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingClaim {
    pub id: u64,
    pub creator: Address,
    pub recipient: Address,
    pub amount: i128,
    pub token: Address,
    pub status: ClaimStatus,
    pub created_at: u64,
    pub claim_window_start: u64,
    pub claim_window_end: u64,
}

/// Result type for get_pending_claim - returns None for non-existent claims.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GetClaimResult {
    Found(PendingClaim),
    NotFound,
}

// Storage keys
const CLAIM_KEY: Symbol = symbol_short!("claim");
const CLAIMS_BY_RECIPIENT: Symbol = symbol_short!("claims_rc");
const CLAIMS_BY_CREATOR: Symbol = symbol_short!("claims_cr");
const CLAIM_WINDOW_CONFIG: Symbol = symbol_short!("claim_cfg");

#[contract]
pub struct WhsperStellar;

#[contractimpl]
impl WhsperStellar {
    /// Get a single pending claim by ID. Returns NotFound for non-existent claims.
    pub fn get_pending_claim(env: Env, claim_id: u64) -> GetClaimResult {
        let key = (CLAIM_KEY, claim_id);
        match env.storage().persistent().get(&key) {
            Some(claim) => GetClaimResult::Found(claim),
            None => GetClaimResult::NotFound,
        }
    }

    /// Get claims by recipient address with pagination.
    /// - `limit`: Max items to return (capped at MAX_PAGE_SIZE)
    /// - `include_claimed_cancelled`: If false, filters out Claimed and Cancelled claims.
    pub fn get_claims_by_recipient(
        env: Env,
        recipient: Address,
        limit: u32,
        include_claimed_cancelled: Option<bool>,
    ) -> Vec<PendingClaim> {
        let limit = limit.min(MAX_PAGE_SIZE).max(1);
        let include_all = include_claimed_cancelled.unwrap_or(false);

        let key = (CLAIMS_BY_RECIPIENT, recipient);
        let claim_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut result = Vec::new(&env);
        for id in claim_ids.iter() {
            if result.len() >= limit {
                break;
            }
            let claim_result = Self::get_pending_claim(env.clone(), id);
            if let GetClaimResult::Found(claim) = claim_result {
                if include_all || claim.status == ClaimStatus::Pending {
                    result.push_back(claim);
                }
            }
        }
        result
    }

    /// Get claims by creator address with pagination.
    /// - `limit`: Max items to return (capped at MAX_PAGE_SIZE)
    /// - `include_claimed_cancelled`: If false, filters out Claimed and Cancelled claims.
    pub fn get_claims_by_creator(
        env: Env,
        creator: Address,
        limit: u32,
        include_claimed_cancelled: Option<bool>,
    ) -> Vec<PendingClaim> {
        let limit = limit.min(MAX_PAGE_SIZE).max(1);
        let include_all = include_claimed_cancelled.unwrap_or(false);

        let key = (CLAIMS_BY_CREATOR, creator);
        let claim_ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut result = Vec::new(&env);
        let len = claim_ids.len();
        for i in 0..len {
            if result.len() >= limit {
                break;
            }
            if let Some(id) = claim_ids.get(i) {
                let claim_result = Self::get_pending_claim(env.clone(), id);
                if let GetClaimResult::Found(claim) = claim_result {
                    if include_all || claim.status == ClaimStatus::Pending {
                        result.push_back(claim);
                    }
                }
            }
        }
        result
    }

    /// Get the claim window configuration. Returns default config if not set.
    pub fn get_claim_window_config(env: Env) -> ClaimWindowConfig {
        env.storage()
            .persistent()
            .get(&CLAIM_WINDOW_CONFIG)
            .unwrap_or_else(|| ClaimWindowConfig::default())
    }
}
