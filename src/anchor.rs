use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env, Map, Symbol, Vec, String};

#[contracttype]
pub struct AnchorInfo {
    pub name: String,
    pub domain: String,
    pub sep6_endpoint: String,
    pub sep24_endpoint: String,
    pub supported_fiat: Vec<Symbol>,
    pub supported_crypto: Vec<Symbol>,
    pub kyc_required: bool,
    pub min_deposit: u64,
    pub max_deposit: u64,
    pub fee_fixed: u64,
    pub fee_percent: u32,
    pub trust_score: u8,
    pub verified: bool,
}

#[contracttype]
pub struct KycRequirement {
    pub jurisdiction: Symbol,
    pub min_kyc_level: u8,
    pub required_fields: Vec<Symbol>,
    pub verification_methods: Vec<Symbol>,
}

#[contracttype]
pub struct DepositInfo {
    pub anchor_id: Address,
    pub fiat_currency: Symbol,
    pub stellar_address: Address,
    pub memo: String,
    pub amount: u64,
    pub fee: u64,
    pub expires_at: u64,
}

#[contracttype]
pub enum AnchorRegistryDataKey {
    Anchor(Address),
    SupportedFiat(Symbol),
    KycRequirements((Symbol, Symbol)), // (fiat_currency, jurisdiction)
    Admin,
}

#[contract]
pub struct AnchorRegistry;

#[contractimpl]
impl AnchorRegistry {
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().instance().has(&AnchorRegistryDataKey::Admin) {
            panic!("already initialized");
        }
        
        env.storage().instance().set(&AnchorRegistryDataKey::Admin, &admin);
    }

    pub fn register_anchor(
        env: Env,
        admin: Address,
        anchor_id: Address,
        anchor_info: AnchorInfo,
    ) -> bool {
        // Check if caller is admin
        let stored_admin = env.storage().instance().get(&AnchorRegistryDataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("unauthorized");
        }

        // Store anchor info
        env.storage().instance().set(
            &AnchorRegistryDataKey::Anchor(anchor_id.clone()),
            &anchor_info,
        );

        // Update supported currencies index
        for currency in anchor_info.supported_fiat.iter() {
            let mut anchors: Vec<Address> = env
                .storage()
                .instance()
                .get(&AnchorRegistryDataKey::SupportedFiat(currency))
                .unwrap_or(Vec::new(&env));
            
            if !anchors.contains(&anchor_id) {
                anchors.push_back(anchor_id.clone());
                env.storage().instance().set(
                    &AnchorRegistryDataKey::SupportedFiat(currency),
                    &anchors,
                );
            }
        }

        true
    }

    pub fn verify_anchor(
        env: Env,
        admin: Address,
        anchor_id: Address,
        verified: bool,
        trust_score: u8,
    ) -> bool {
        // Check if caller is admin
        let stored_admin = env.storage().instance().get(&AnchorRegistryDataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("unauthorized");
        }

        // Get existing anchor info
        let mut anchor_info: AnchorInfo = env
            .storage()
            .instance()
            .get(&AnchorRegistryDataKey::Anchor(anchor_id.clone()))
            .unwrap_or_else(|| panic!("anchor not found"));

        // Update verification status and trust score
        anchor_info.verified = verified;
        anchor_info.trust_score = trust_score;

        // Store updated info
        env.storage().instance().set(
            &AnchorRegistryDataKey::Anchor(anchor_id),
            &anchor_info,
        );

        true
    }

    pub fn get_anchor_info(env: Env, anchor_id: Address) -> AnchorInfo {
        env.storage()
            .instance()
            .get(&AnchorRegistryDataKey::Anchor(anchor_id))
            .unwrap_or_else(|| panic!("anchor not found"))
    }

    pub fn get_anchors_for_fiat(env: Env, fiat_currency: Symbol) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&AnchorRegistryDataKey::SupportedFiat(fiat_currency))
            .unwrap_or(Vec::new(&env))
    }

    pub fn get_verified_anchors(env: Env, fiat_currency: Symbol) -> Vec<Address> {
        let all_anchors = Self::get_anchors_for_fiat(env.clone(), fiat_currency);
        let mut verified_anchors = Vec::new(&env);

        for anchor_id in all_anchors.iter() {
            let anchor_info = Self::get_anchor_info(env.clone(), anchor_id);
            if anchor_info.verified {
                verified_anchors.push_back(anchor_id);
            }
        }

        verified_anchors
    }

    pub fn set_kyc_requirements(
        env: Env,
        admin: Address,
        fiat_currency: Symbol,
        jurisdiction: Symbol,
        requirements: KycRequirement,
    ) -> bool {
        // Check if caller is admin
        let stored_admin = env.storage().instance().get(&AnchorRegistryDataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("unauthorized");
        }

        env.storage().instance().set(
            &AnchorRegistryDataKey::KycRequirements((fiat_currency, jurisdiction)),
            &requirements,
        );

        true
    }

    pub fn get_kyc_requirements(
        env: Env,
        fiat_currency: Symbol,
        jurisdiction: Symbol,
    ) -> KycRequirement {
        env.storage()
            .instance()
            .get(&AnchorRegistryDataKey::KycRequirements((fiat_currency, jurisdiction)))
            .unwrap_or_else(|| KycRequirement {
                jurisdiction,
                min_kyc_level: 1,
                required_fields: Vec::new(&env),
                verification_methods: Vec::new(&env),
            })
    }

    pub fn get_deposit_url(
        env: Env,
        anchor_id: Address,
        fiat_currency: Symbol,
        stellar_address: Address,
        amount: u64,
    ) -> DepositInfo {
        let anchor_info = Self::get_anchor_info(env.clone(), anchor_id.clone());

        // Check if fiat currency is supported
        if !anchor_info.supported_fiat.contains(&fiat_currency) {
            panic!("fiat currency not supported by this anchor");
        }

        // Calculate fees
        let fee_fixed = anchor_info.fee_fixed;
        let fee_percent_amount = (amount * anchor_info.fee_percent as u64) / 10000;
        let total_fee = fee_fixed + fee_percent_amount;

        // Check deposit limits
        if amount < anchor_info.min_deposit {
            panic!("amount below minimum deposit");
        }
        if amount > anchor_info.max_deposit {
            panic!("amount above maximum deposit");
        }

        // Generate memo (in real implementation, this would be more sophisticated)
        let memo = format!("{}_{}", stellar_address, env.ledger().timestamp());

        // Set expiration (24 hours from now)
        let expires_at = env.ledger().timestamp() + 86400;

        DepositInfo {
            anchor_id,
            fiat_currency,
            stellar_address,
            memo,
            amount,
            fee: total_fee,
            expires_at,
        }
    }

    pub fn compare_fees(
        env: Env,
        fiat_currency: Symbol,
        amount: u64,
    ) -> Map<Address, u64> {
        let anchors = Self::get_verified_anchors(env.clone(), fiat_currency);
        let mut fee_comparison = Map::new(&env);

        for anchor_id in anchors.iter() {
            let anchor_info = Self::get_anchor_info(env.clone(), anchor_id.clone());
            let fee_fixed = anchor_info.fee_fixed;
            let fee_percent_amount = (amount * anchor_info.fee_percent as u64) / 10000;
            let total_fee = fee_fixed + fee_percent_amount;
            
            fee_comparison.set(anchor_id, total_fee);
        }

        fee_comparison
    }

    pub fn get_best_anchor(
        env: Env,
        fiat_currency: Symbol,
        amount: u64,
    ) -> Address {
        let fee_comparison = Self::compare_fees(env.clone(), fiat_currency, amount);
        
        let mut best_anchor = Address::generate(&env);
        let mut lowest_fee = u64::MAX;

        for (anchor_id, fee) in fee_comparison.iter() {
            if fee < lowest_fee {
                lowest_fee = fee;
                best_anchor = anchor_id;
            }
        }

        best_anchor
    }

    pub fn update_anchor_fees(
        env: Env,
        admin: Address,
        anchor_id: Address,
        fee_fixed: u64,
        fee_percent: u32,
    ) -> bool {
        // Check if caller is admin
        let stored_admin = env.storage().instance().get(&AnchorRegistryDataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("unauthorized");
        }

        // Get existing anchor info
        let mut anchor_info: AnchorInfo = env
            .storage()
            .instance()
            .get(&AnchorRegistryDataKey::Anchor(anchor_id.clone()))
            .unwrap_or_else(|| panic!("anchor not found"));

        // Update fees
        anchor_info.fee_fixed = fee_fixed;
        anchor_info.fee_percent = fee_percent;

        // Store updated info
        env.storage().instance().set(
            &AnchorRegistryDataKey::Anchor(anchor_id),
            &anchor_info,
        );

        true
    }

    pub fn remove_anchor(env: Env, admin: Address, anchor_id: Address) -> bool {
        // Check if caller is admin
        let stored_admin = env.storage().instance().get(&AnchorRegistryDataKey::Admin).unwrap();
        if admin != stored_admin {
            panic!("unauthorized");
        }

        // Get anchor info before removal
        let anchor_info: AnchorInfo = env
            .storage()
            .instance()
            .get(&AnchorRegistryDataKey::Anchor(anchor_id.clone()))
            .unwrap_or_else(|| panic!("anchor not found"));

        // Remove from supported currencies index
        for currency in anchor_info.supported_fiat.iter() {
            let mut anchors: Vec<Address> = env
                .storage()
                .instance()
                .get(&AnchorRegistryDataKey::SupportedFiat(currency))
                .unwrap_or(Vec::new(&env));
            
            let index = anchors.iter().position(|a| a == &anchor_id);
            if let Some(idx) = index {
                anchors.remove(idx);
                env.storage().instance().set(
                    &AnchorRegistryDataKey::SupportedFiat(currency),
                    &anchors,
                );
            }
        }

        // Remove anchor info
        env.storage()
            .instance()
            .remove(&AnchorRegistryDataKey::Anchor(anchor_id));

        true
    }
}
