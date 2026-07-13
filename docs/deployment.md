# Contract Deployment Guide

This document covers everything needed to compile the Soroban smart contracts, deploy them to testnet or mainnet, and wire the resulting addresses into the SDK and CLI.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Build order overview](#build-order-overview)
- [1. Compile the Rust contracts](#1-compile-the-rust-contracts)
- [2. Deploy to testnet](#2-deploy-to-testnet)
  - [2a. Generate and fund an admin keypair](#2a-generate-and-fund-an-admin-keypair)
  - [2b. Deploy the three contracts](#2b-deploy-the-three-contracts)
  - [2c. Initialise each contract](#2c-initialise-each-contract)
  - [2d. Seed the rate oracle](#2d-seed-the-rate-oracle)
  - [2e. Register compliance users](#2e-register-compliance-users)
- [3. Verify deployed contracts](#3-verify-deployed-contracts)
- [4. Wire addresses into the SDK](#4-wire-addresses-into-the-sdk)
- [5. Wire addresses into the CLI](#5-wire-addresses-into-the-cli)
- [6. Deploy to mainnet](#6-deploy-to-mainnet)
- [Example testnet addresses](#example-testnet-addresses)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Rust + Cargo | stable (≥1.78) | `curl https://sh.rustup.rs -sSf \| sh` |
| wasm32 target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥21 | see below |
| Node.js | ≥18 | https://nodejs.org |

**Install Stellar CLI:**

```bash
# via cargo (recommended)
cargo install --locked stellar-cli@21

# verify
stellar --version
```

> On Windows use the PowerShell installer from
> https://github.com/stellar/stellar-cli/releases or run inside WSL2.

---

## Build order overview

```
src/ (Rust contracts)
  └── cargo build --release → target/wasm32-unknown-unknown/release/*.wasm
        │
        ▼  (deploy, get contract IDs)
sdk/
  └── npm run build → sdk/dist/      (depends on contract addresses in .env)
        │
        ▼
cli/
  └── npm run build → cli/dist/
        │
        ▼
ui/
  └── npm run build → ui/.next/
```

Use the top-level scripts to run the TypeScript part:

```bash
# Full build (contracts + all TS packages)
npm run build:full

# Or step by step
npm run build:contracts
npm run build:sdk
npm run build:cli
npm run build:ui

# Type-check only (no emit)
npm run type-check
```

---

## 1. Compile the Rust contracts

```bash
# From the repo root
cargo build --release --target wasm32-unknown-unknown
```

The compiled WASM artefact is a single library that exports all four contracts:

```
target/wasm32-unknown-unknown/release/stellar_cross_border_payments_sdk.wasm
```

Optimise for size (optional but recommended for mainnet):

```bash
# Requires wasm-opt from binaryen
wasm-opt -Oz \
  target/wasm32-unknown-unknown/release/stellar_cross_border_payments_sdk.wasm \
  -o target/wasm32-unknown-unknown/release/stellar_cross_border_payments_sdk_opt.wasm
```

Run the contract unit tests before deploying:

```bash
cargo test
```

---

## 2. Deploy to testnet

### 2a. Generate and fund an admin keypair

```bash
# Generate a new keypair for the admin account
stellar keys generate admin --network testnet

# Print the public key
stellar keys address admin

# Fund via Friendbot (testnet only — gives 10,000 XLM)
stellar keys fund admin --network testnet
```

Store the secret key in your `.env`:

```bash
# Copy the template first if you haven't already
cp .env.example .env
```

Then set:

```dotenv
ADMIN_SECRET_KEY=<output of: stellar keys show admin>
ADMIN_PUBLIC_KEY=<output of: stellar keys address admin>
```

> Never commit a `.env` file with real keys. The `.gitignore` already excludes it.

---

### 2b. Deploy the three contracts

Each `stellar contract deploy` call uploads the WASM to the network and
returns a **contract ID** — a 56-character string starting with `C`.

```bash
WASM=target/wasm32-unknown-unknown/release/stellar_cross_border_payments_sdk.wasm

# Deploy Escrow contract
ESCROW_CONTRACT_ADDRESS=$(stellar contract deploy \
  --wasm "$WASM" \
  --source admin \
  --network testnet \
  --alias escrow)
echo "Escrow contract:     $ESCROW_CONTRACT_ADDRESS"

# Deploy Rate Oracle contract
RATE_ORACLE_CONTRACT_ADDRESS=$(stellar contract deploy \
  --wasm "$WASM" \
  --source admin \
  --network testnet \
  --alias rate_oracle)
echo "Rate Oracle contract: $RATE_ORACLE_CONTRACT_ADDRESS"

# Deploy Compliance contract
COMPLIANCE_CONTRACT_ADDRESS=$(stellar contract deploy \
  --wasm "$WASM" \
  --source admin \
  --network testnet \
  --alias compliance)
echo "Compliance contract:  $COMPLIANCE_CONTRACT_ADDRESS"
```

Update `.env` with the returned addresses:

```dotenv
ESCROW_CONTRACT_ADDRESS=C...
RATE_ORACLE_CONTRACT_ADDRESS=C...
COMPLIANCE_CONTRACT_ADDRESS=C...
```

---

### 2c. Initialise each contract

Every contract stores an admin address that must be set before any other
functions can be called.  This is a one-time bootstrapping step.

```bash
ADMIN_PUBLIC=$(stellar keys address admin)

# Initialise Compliance contract admin
stellar contract invoke \
  --id "$COMPLIANCE_CONTRACT_ADDRESS" \
  --source admin \
  --network testnet \
  -- set_admin \
  --admin "$ADMIN_PUBLIC"

# Initialise Rate Oracle contract admin
stellar contract invoke \
  --id "$RATE_ORACLE_CONTRACT_ADDRESS" \
  --source admin \
  --network testnet \
  -- set_admin \
  --admin "$ADMIN_PUBLIC"

# Initialise Anchor Registry admin
stellar contract invoke \
  --id "$ESCROW_CONTRACT_ADDRESS" \
  --source admin \
  --network testnet \
  -- initialize \
  --admin "$ADMIN_PUBLIC"
```

Add restricted jurisdictions (matches `.env` `RESTRICTED_JURISDICTIONS`):

```bash
for jurisdiction in IR NP KP; do
  stellar contract invoke \
    --id "$COMPLIANCE_CONTRACT_ADDRESS" \
    --source admin \
    --network testnet \
    -- add_restricted_jurisdiction \
    --jurisdiction "$jurisdiction"
done
```

---

### 2d. Seed the rate oracle

The rate oracle aggregates rates from authorised sources.  For development,
you can register the admin account as a rate source and submit initial rates.

```bash
# Register admin as a rate source (weight 100 = sole source in dev)
stellar contract invoke \
  --id "$RATE_ORACLE_CONTRACT_ADDRESS" \
  --source admin \
  --network testnet \
  -- add_rate_source \
  --name USD \
  --address "$ADMIN_PUBLIC" \
  --weight 100

# Submit USD → MXN rate  (rate is scaled by 1,000,000 — 18.50 MXN = 18500000)
stellar contract invoke \
  --id "$RATE_ORACLE_CONTRACT_ADDRESS" \
  --source admin \
  --network testnet \
  -- submit_rate \
  --source "$ADMIN_PUBLIC" \
  --from_currency USD \
  --to_currency MXN \
  --rate 18500000 \
  --confidence 90

# Submit USD → EUR rate  (0.92 EUR = 920000)
stellar contract invoke \
  --id "$RATE_ORACLE_CONTRACT_ADDRESS" \
  --source admin \
  --network testnet \
  -- submit_rate \
  --source "$ADMIN_PUBLIC" \
  --from_currency USD \
  --to_currency EUR \
  --rate 920000 \
  --confidence 90
```

---

### 2e. Register compliance users

Every account that sends or receives a payment must have a compliance record
on-chain.  In production this is handled by your KYC provider; for local
testing register the admin and any test accounts manually.

```bash
# Register admin / sender with basic KYC
stellar contract invoke \
  --id "$COMPLIANCE_CONTRACT_ADDRESS" \
  --source admin \
  --network testnet \
  -- register_user \
  --user "$ADMIN_PUBLIC" \
  --kyc_level Basic \
  --risk_level Low \
  --jurisdiction US \
  --aml_flags '[]' \
  --transaction_limits '{"USDC":1000000000}'
```

---

## 3. Verify deployed contracts

```bash
# Read back the rate you just submitted
stellar contract invoke \
  --id "$RATE_ORACLE_CONTRACT_ADDRESS" \
  --source admin \
  --network testnet \
  -- get_rate \
  --from_currency USD \
  --to_currency MXN

# Check compliance record
stellar contract invoke \
  --id "$COMPLIANCE_CONTRACT_ADDRESS" \
  --source admin \
  --network testnet \
  -- get_user_compliance \
  --user "$ADMIN_PUBLIC"
```

You can also inspect any contract on the Stellar testnet explorer:

```
https://stellar.expert/explorer/testnet/contract/<CONTRACT_ADDRESS>
```

---

## 4. Wire addresses into the SDK

```typescript
// sdk usage — pass contract addresses to the SDK constructor
import { StellarCrossBorderSDK } from '@stellar-cross-border/sdk';

const config = StellarCrossBorderSDK.createTestnetConfig();

const sdk = new StellarCrossBorderSDK(config, {
  escrow:      process.env.ESCROW_CONTRACT_ADDRESS!,
  rateOracle:  process.env.RATE_ORACLE_CONTRACT_ADDRESS!,
  compliance:  process.env.COMPLIANCE_CONTRACT_ADDRESS!,
});
```

The SDK reads the environment variables automatically when you use
`dotenv.config()` at application startup, so a populated `.env` file is
sufficient — no hard-coded addresses needed.

---

## 5. Wire addresses into the CLI

Pass the addresses as flags or set them in `.env`:

```bash
# Via flags
stellar-payout batch \
  --input payments.csv \
  --source-secret "$ADMIN_SECRET_KEY" \
  --network testnet \
  --escrow-contract "$ESCROW_CONTRACT_ADDRESS" \
  --rate-oracle-contract "$RATE_ORACLE_CONTRACT_ADDRESS" \
  --compliance-contract "$COMPLIANCE_CONTRACT_ADDRESS"

# Or set in .env and omit the flags — the CLI reads them automatically
stellar-payout batch --input payments.csv --source-secret "$ADMIN_SECRET_KEY"
```

---

## 6. Deploy to mainnet

The procedure mirrors testnet with three differences:

1. Use `--network mainnet` in every `stellar` command.
2. Fund the admin account with real XLM (minimum ~5 XLM per contract for
   storage deposits plus transaction fees).
3. Use `stellar_cross_border_payments_sdk_opt.wasm` (the wasm-opt output)
   to reduce upload cost.

```bash
WASM=target/wasm32-unknown-unknown/release/stellar_cross_border_payments_sdk_opt.wasm

ESCROW_CONTRACT_ADDRESS=$(stellar contract deploy \
  --wasm "$WASM" \
  --source admin \
  --network mainnet \
  --alias escrow_prod)

RATE_ORACLE_CONTRACT_ADDRESS=$(stellar contract deploy \
  --wasm "$WASM" \
  --source admin \
  --network mainnet \
  --alias rate_oracle_prod)

COMPLIANCE_CONTRACT_ADDRESS=$(stellar contract deploy \
  --wasm "$WASM" \
  --source admin \
  --network mainnet \
  --alias compliance_prod)
```

Then repeat the initialisation commands with `--network mainnet`.

Update your production `.env` (or secrets manager) with the mainnet addresses
and set:

```dotenv
HORIZON_URL=https://horizon.stellar.org
SOROBAN_RPC_URL=https://soroban-rpc.mainnet.stellar.gateway.fm
NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

---

## Example testnet addresses

These addresses are provided for reference only and reflect a development
deployment used during SDK testing.  They may be decommissioned at any time.
Generate your own using the steps above.

```dotenv
# Testnet — development deployment (may be unavailable)
HORIZON_URL=https://horizon-testnet.stellar.org
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
NETWORK_PASSPHRASE=Test SDF Network ; September 2015

ESCROW_CONTRACT_ADDRESS=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM
RATE_ORACLE_CONTRACT_ADDRESS=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFKU4
COMPLIANCE_CONTRACT_ADDRESS=CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHHB4
```

> These are placeholder addresses.  Replace them with your own deployed contract
> IDs from the steps above.

---

## Troubleshooting

**`wasm32-unknown-unknown` target missing**

```bash
rustup target add wasm32-unknown-unknown
```

**`stellar: command not found`**

```bash
cargo install --locked stellar-cli@21
# Then add ~/.cargo/bin to PATH
```

**`Error: insufficient balance` during deploy**

The admin account needs XLM to pay transaction fees and storage deposits.
On testnet use Friendbot (`stellar keys fund admin --network testnet`).
On mainnet purchase XLM and transfer to the admin address.

**`Error: Admin not set` when invoking contract functions**

You must call `set_admin` / `initialize` on each contract before any other
function.  See [2c. Initialise each contract](#2c-initialise-each-contract).

**Rate not found for currency pair**

The rate oracle has no data for that pair.  Submit a rate with `submit_rate`
as described in [2d. Seed the rate oracle](#2d-seed-the-rate-oracle).

**`Error: User not registered` during compliance check**

Register the sender and receiver accounts with `register_user` before
submitting a payment.  See [2e. Register compliance users](#2e-register-compliance-users).
