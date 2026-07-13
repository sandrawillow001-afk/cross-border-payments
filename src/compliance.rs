use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol, Map, Vec, BytesN};

#[contracttype]
pub enum ComplianceLevel {
    None,
    Basic,
    Enhanced,
    Full,
}

#[contracttype]
pub enum RiskLevel {
    Low,
    Medium,
    High,
    Restricted,
}

#[contracttype]
pub struct ComplianceRecord {
    pub user: Address,
    pub kyc_level: ComplianceLevel,
    pub risk_level: RiskLevel,
    pub jurisdiction: Symbol,
    pub registration_date: u64,
    pub last_updated: u64,
    pub aml_flags: Vec<Symbol>,
    pub transaction_limits: Map<Symbol, i128>,
}

#[contracttype]
pub struct TransactionRule {
    pub id: BytesN<32>,
    pub name: Symbol,
    pub description: Symbol,
    pub conditions: Map<Symbol, Vec<u8>>,
    pub actions: Map<Symbol, Vec<u8>>,
    pub active: bool,
    pub priority: u8,
}

#[contracttype]
pub struct ComplianceCheck {
    pub transaction_id: BytesN<32>,
    pub from_user: Address,
    pub to_user: Address,
    pub amount: i128,
    pub currency: Symbol,
    pub jurisdiction_from: Symbol,
    pub jurisdiction_to: Symbol,
    pub timestamp: u64,
    pub approved: bool,
    pub reason: Symbol,
    pub rules_triggered: Vec<BytesN<32>>,
}

pub struct ComplianceContract;

#[contract]
pub trait ComplianceTrait {
    fn register_user(
        env: Env,
        user: Address,
        kyc_level: ComplianceLevel,
        risk_level: RiskLevel,
        jurisdiction: Symbol,
        aml_flags: Vec<Symbol>,
        transaction_limits: Map<Symbol, i128>,
    ) -> bool;

    fn update_user_compliance(
        env: Env,
        user: Address,
        kyc_level: ComplianceLevel,
        risk_level: RiskLevel,
        aml_flags: Vec<Symbol>,
        transaction_limits: Map<Symbol, i128>,
    ) -> bool;

    fn check_transaction_compliance(
        env: Env,
        transaction_id: BytesN<32>,
        from_user: Address,
        to_user: Address,
        amount: i128,
        currency: Symbol,
        jurisdiction_from: Symbol,
        jurisdiction_to: Symbol,
    ) -> ComplianceCheck;

    fn add_compliance_rule(
        env: Env,
        name: Symbol,
        description: Symbol,
        conditions: Map<Symbol, Vec<u8>>,
        actions: Map<Symbol, Vec<u8>>,
        priority: u8,
    ) -> BytesN<32>;

    fn update_compliance_rule(
        env: Env,
        rule_id: BytesN<32>,
        active: bool,
        priority: u8,
    ) -> bool;

    fn get_user_compliance(env: Env, user: Address) -> ComplianceRecord;

    fn get_compliance_rules(env: Env) -> Vec<TransactionRule>;

    fn get_transaction_history(env: Env, user: Address) -> Vec<ComplianceCheck>;

    fn set_admin(env: Env, admin: Address);

    fn add_restricted_jurisdiction(env: Env, jurisdiction: Symbol);

    fn remove_restricted_jurisdiction(env: Env, jurisdiction: Symbol);

    fn is_jurisdiction_restricted(env: Env, jurisdiction: Symbol) -> bool;
}

#[contractimpl]
impl ComplianceTrait for ComplianceContract {
    fn register_user(
        env: Env,
        user: Address,
        kyc_level: ComplianceLevel,
        risk_level: RiskLevel,
        jurisdiction: Symbol,
        aml_flags: Vec<Symbol>,
        transaction_limits: Map<Symbol, i128>,
    ) -> bool {
        let admin_key = Symbol::new(&env, "ADMIN");
        let admin = env.storage().persistent().get::<_, Address>(&admin_key)
            .unwrap_or_else(|| panic!("Admin not set"));
        admin.require_auth();

        let compliance_record = ComplianceRecord {
            user: user.clone(),
            kyc_level,
            risk_level,
            jurisdiction,
            registration_date: env.ledger().timestamp(),
            last_updated: env.ledger().timestamp(),
            aml_flags,
            transaction_limits,
        };

        let records_key = Symbol::new(&env, "COMPLIANCE_RECORDS");
        let mut records = env.storage().persistent().get::<_, Map<Address, ComplianceRecord>>(&records_key)
            .unwrap_or_else(|| Map::new(&env));
        records.set(user, compliance_record);
        env.storage().persistent().set(&records_key, &records);

        true
    }

    fn update_user_compliance(
        env: Env,
        user: Address,
        kyc_level: ComplianceLevel,
        risk_level: RiskLevel,
        aml_flags: Vec<Symbol>,
        transaction_limits: Map<Symbol, i128>,
    ) -> bool {
        let admin_key = Symbol::new(&env, "ADMIN");
        let admin = env.storage().persistent().get::<_, Address>(&admin_key)
            .unwrap_or_else(|| panic!("Admin not set"));
        admin.require_auth();

        let records_key = Symbol::new(&env, "COMPLIANCE_RECORDS");
        let mut records = env.storage().persistent().get::<_, Map<Address, ComplianceRecord>>(&records_key)
            .unwrap_or_else(|| Map::new(&env));

        let mut record = records.get(user.clone())
            .unwrap_or_else(|| panic!("User not registered"));

        record.kyc_level = kyc_level;
        record.risk_level = risk_level;
        record.aml_flags = aml_flags;
        record.transaction_limits = transaction_limits;
        record.last_updated = env.ledger().timestamp();

        records.set(user, record);
        env.storage().persistent().set(&records_key, &records);

        true
    }

    fn check_transaction_compliance(
        env: Env,
        transaction_id: BytesN<32>,
        from_user: Address,
        to_user: Address,
        amount: i128,
        currency: Symbol,
        jurisdiction_from: Symbol,
        jurisdiction_to: Symbol,
    ) -> ComplianceCheck {
        let restricted_key = Symbol::new(&env, "RESTRICTED_JURISDICTIONS");
        let restricted_jurisdictions = env.storage().persistent().get::<_, Vec<Symbol>>(&restricted_key)
            .unwrap_or_else(|| Vec::new(&env));

        if restricted_jurisdictions.contains(&jurisdiction_from) || restricted_jurisdictions.contains(&jurisdiction_to) {
            return ComplianceCheck {
                transaction_id,
                from_user: from_user.clone(),
                to_user: to_user.clone(),
                amount,
                currency,
                jurisdiction_from,
                jurisdiction_to,
                timestamp: env.ledger().timestamp(),
                approved: false,
                reason: Symbol::new(&env, "RESTRICTED_JURISDICTION"),
                rules_triggered: Vec::new(&env),
            };
        }

        let records_key = Symbol::new(&env, "COMPLIANCE_RECORDS");
        let records = env.storage().persistent().get::<_, Map<Address, ComplianceRecord>>(&records_key)
            .unwrap_or_else(|| Map::new(&env));

        let from_record = match records.get(from_user.clone()) {
            Some(record) => record,
            None => {
                return ComplianceCheck {
                    transaction_id,
                    from_user: from_user.clone(),
                    to_user: to_user.clone(),
                    amount,
                    currency,
                    jurisdiction_from,
                    jurisdiction_to,
                    timestamp: env.ledger().timestamp(),
                    approved: false,
                    reason: Symbol::new(&env, "SENDER_NOT_REGISTERED"),
                    rules_triggered: Vec::new(&env),
                };
            }
        };
        let to_record = match records.get(to_user.clone()) {
            Some(record) => record,
            None => {
                return ComplianceCheck {
                    transaction_id,
                    from_user,
                    to_user,
                    amount,
                    currency,
                    jurisdiction_from,
                    jurisdiction_to,
                    timestamp: env.ledger().timestamp(),
                    approved: false,
                    reason: Symbol::new(&env, "RECEIVER_NOT_REGISTERED"),
                    rules_triggered: Vec::new(&env),
                };
            }
        };

        if from_record.risk_level == RiskLevel::Restricted || to_record.risk_level == RiskLevel::Restricted {
            return ComplianceCheck {
                transaction_id,
                from_user: from_user.clone(),
                to_user: to_user.clone(),
                amount,
                currency,
                jurisdiction_from,
                jurisdiction_to,
                timestamp: env.ledger().timestamp(),
                approved: false,
                reason: Symbol::new(&env, "RESTRICTED_USER"),
                rules_triggered: Vec::new(&env),
            };
        }

        let from_limit = from_record.transaction_limits.get(currency.clone())
            .unwrap_or(&0i128);
        if amount > *from_limit {
            return ComplianceCheck {
                transaction_id,
                from_user: from_user.clone(),
                to_user: to_user.clone(),
                amount,
                currency,
                jurisdiction_from,
                jurisdiction_to,
                timestamp: env.ledger().timestamp(),
                approved: false,
                reason: Symbol::new(&env, "EXCEEDS_LIMIT"),
                rules_triggered: Vec::new(&env),
            };
        }

        let rules_key = Symbol::new(&env, "COMPLIANCE_RULES");
        let rules = env.storage().persistent().get::<_, Vec<TransactionRule>>(&rules_key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut rules_triggered = Vec::new(&env);
        let mut approved = true;
        let mut reason = Symbol::new(&env, "APPROVED");

        for rule in rules.iter() {
            if rule.active && Self::evaluate_rule(&env, &rule, &from_record, &to_record, amount, &currency) {
                rules_triggered.push_back(rule.id);
                
                if rule.priority >= 8 {
                    approved = false;
                    reason = Symbol::new(&env, "HIGH_PRIORITY_RULE_TRIGGERED");
                    break;
                }
            }
        }

        let compliance_check = ComplianceCheck {
            transaction_id,
            from_user,
            to_user,
            amount,
            currency,
            jurisdiction_from,
            jurisdiction_to,
            timestamp: env.ledger().timestamp(),
            approved,
            reason,
            rules_triggered,
        };

        let history_key = Symbol::new(&env, "COMPLIANCE_HISTORY");
        let mut history = env.storage().persistent().get::<_, Vec<ComplianceCheck>>(&history_key)
            .unwrap_or_else(|| Vec::new(&env));
        history.push_back(compliance_check.clone());
        env.storage().persistent().set(&history_key, &history);

        compliance_check
    }

    fn add_compliance_rule(
        env: Env,
        name: Symbol,
        description: Symbol,
        conditions: Map<Symbol, Vec<u8>>,
        actions: Map<Symbol, Vec<u8>>,
        priority: u8,
    ) -> BytesN<32> {
        let admin_key = Symbol::new(&env, "ADMIN");
        let admin = env.storage().persistent().get::<_, Address>(&admin_key)
            .unwrap_or_else(|| panic!("Admin not set"));
        admin.require_auth();

        let rule_id = env.crypto().sha256(&(
            name,
            description,
            env.ledger().timestamp(),
        ).into());

        let rule = TransactionRule {
            id: rule_id.clone(),
            name,
            description,
            conditions,
            actions,
            active: true,
            priority,
        };

        let rules_key = Symbol::new(&env, "COMPLIANCE_RULES");
        let mut rules = env.storage().persistent().get::<_, Vec<TransactionRule>>(&rules_key)
            .unwrap_or_else(|| Vec::new(&env));
        rules.push_back(rule);
        env.storage().persistent().set(&rules_key, &rules);

        rule_id
    }

    fn update_compliance_rule(
        env: Env,
        rule_id: BytesN<32>,
        active: bool,
        priority: u8,
    ) -> bool {
        let admin_key = Symbol::new(&env, "ADMIN");
        let admin = env.storage().persistent().get::<_, Address>(&admin_key)
            .unwrap_or_else(|| panic!("Admin not set"));
        admin.require_auth();

        let rules_key = Symbol::new(&env, "COMPLIANCE_RULES");
        let mut rules = env.storage().persistent().get::<_, Vec<TransactionRule>>(&rules_key)
            .unwrap_or_else(|| Vec::new(&env));

        for i in 0..rules.len() {
            let rule = rules.get(i).unwrap();
            if rule.id == rule_id {
                let mut updated_rule = rule;
                updated_rule.active = active;
                updated_rule.priority = priority;
                rules.set(i, updated_rule);
                env.storage().persistent().set(&rules_key, &rules);
                return true;
            }
        }

        panic!("Rule not found")
    }

    fn get_user_compliance(env: Env, user: Address) -> ComplianceRecord {
        let records_key = Symbol::new(&env, "COMPLIANCE_RECORDS");
        let records = env.storage().persistent().get::<_, Map<Address, ComplianceRecord>>(&records_key)
            .unwrap_or_else(|| Map::new(&env));

        records.get(user)
            .unwrap_or_else(|| panic!("User not registered"))
    }

    fn get_compliance_rules(env: Env) -> Vec<TransactionRule> {
        let rules_key = Symbol::new(&env, "COMPLIANCE_RULES");
        env.storage().persistent().get::<_, Vec<TransactionRule>>(&rules_key)
            .unwrap_or_else(|| Vec::new(&env))
    }

    fn get_transaction_history(env: Env, user: Address) -> Vec<ComplianceCheck> {
        let history_key = Symbol::new(&env, "COMPLIANCE_HISTORY");
        let history = env.storage().persistent().get::<_, Vec<ComplianceCheck>>(&history_key)
            .unwrap_or_else(|| Vec::new(&env));

        let mut user_history = Vec::new(&env);
        for check in history.iter() {
            if check.from_user == user || check.to_user == user {
                user_history.push_back(check);
            }
        }

        user_history
    }

    fn set_admin(env: Env, admin: Address) {
        let admin_key = Symbol::new(&env, "ADMIN");
        env.storage().persistent().set(&admin_key, &admin);
    }

    fn add_restricted_jurisdiction(env: Env, jurisdiction: Symbol) {
        let admin_key = Symbol::new(&env, "ADMIN");
        let admin = env.storage().persistent().get::<_, Address>(&admin_key)
            .unwrap_or_else(|| panic!("Admin not set"));
        admin.require_auth();

        let restricted_key = Symbol::new(&env, "RESTRICTED_JURISDICTIONS");
        let mut restricted = env.storage().persistent().get::<_, Vec<Symbol>>(&restricted_key)
            .unwrap_or_else(|| Vec::new(&env));
        
        if !restricted.contains(&jurisdiction) {
            restricted.push_back(jurisdiction);
            env.storage().persistent().set(&restricted_key, &restricted);
        }
    }

    fn remove_restricted_jurisdiction(env: Env, jurisdiction: Symbol) {
        let admin_key = Symbol::new(&env, "ADMIN");
        let admin = env.storage().persistent().get::<_, Address>(&admin_key)
            .unwrap_or_else(|| panic!("Admin not set"));
        admin.require_auth();

        let restricted_key = Symbol::new(&env, "RESTRICTED_JURISDICTIONS");
        let mut restricted = env.storage().persistent().get::<_, Vec<Symbol>>(&restricted_key)
            .unwrap_or_else(|| Vec::new(&env));
        
        let mut new_restricted = Vec::new(&env);
        for j in restricted.iter() {
            if j != jurisdiction {
                new_restricted.push_back(j);
            }
        }
        env.storage().persistent().set(&restricted_key, &new_restricted);
    }

    fn is_jurisdiction_restricted(env: Env, jurisdiction: Symbol) -> bool {
        let restricted_key = Symbol::new(&env, "RESTRICTED_JURISDICTIONS");
        let restricted = env.storage().persistent().get::<_, Vec<Symbol>>(&restricted_key)
            .unwrap_or_else(|| Vec::new(&env));
        
        restricted.contains(&jurisdiction)
    }
}

impl ComplianceContract {
    fn evaluate_rule(
        env: &Env,
        rule: &TransactionRule,
        from_record: &ComplianceRecord,
        to_record: &ComplianceRecord,
        amount: i128,
        currency: &Symbol,
    ) -> bool {
        for (condition_key, condition_value) in rule.conditions.iter() {
            match condition_key.to_string().as_str() {
                "HIGH_RISK_SENDER" => {
                    if from_record.risk_level == RiskLevel::High {
                        return true;
                    }
                }
                "HIGH_RISK_RECEIVER" => {
                    if to_record.risk_level == RiskLevel::High {
                        return true;
                    }
                }
                "HIGH_AMOUNT_THRESHOLD" => {
                    let threshold = i128::from_be_bytes(condition_value.try_into().unwrap());
                    if amount > threshold {
                        return true;
                    }
                }
                "AML_FLAGGED_SENDER" => {
                    if !from_record.aml_flags.is_empty() {
                        return true;
                    }
                }
                "AML_FLAGGED_RECEIVER" => {
                    if !to_record.aml_flags.is_empty() {
                        return true;
                    }
                }
                "CROSS_BORDER_HIGH_VALUE" => {
                    let threshold = i128::from_be_bytes(condition_value.try_into().unwrap());
                    if from_record.jurisdiction != to_record.jurisdiction && amount > threshold {
                        return true;
                    }
                }
                _ => {}
            }
        }
        false
    }
}
