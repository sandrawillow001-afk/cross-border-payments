# Secret Handling & Key Security Guide

This document defines how secrets — especially Stellar private keys — must be
handled across the three layers of this project: the Rust contracts, the
TypeScript SDK, and the Next.js UI.  Every developer and operations person who
touches this repo must read and follow these rules.

---

## 1. The cardinal rule

> **Private keys must never be loaded, stored, or even referenced in browser
> JavaScript.**

A Stellar secret key (`S…`) gives anyone who holds it unconditional control over
the account.  Browser environments are fundamentally insecure: browser
extensions, XSS vulnerabilities, and compromised CDN assets can all read
JavaScript memory.  There is no safe way to embed a secret key in client-side
code.

---

## 2. What goes where

| Secret type                      | Allowed in CLI | Allowed in SDK (server) | Allowed in UI / browser |
|----------------------------------|:--------------:|:-----------------------:|:-----------------------:|
| `ADMIN_SECRET_KEY`               | ✅ via env var | ✅ via env var          | ❌ never                |
| Sender / signer `Keypair`        | ✅ via env var | ✅ server-side only     | ❌ never                |
| `WEBHOOK_SECRET`                 | ✅ via env var | ✅ via env var          | ❌ never                |
| `DATABASE_URL` / `REDIS_URL`     | ✅ via env var | ✅ via env var          | ❌ never                |
| `COINGECKO_API_KEY`              | ✅ via env var | ✅ via env var          | ❌ never                |
| `NEXT_PUBLIC_*` variables        | —              | —                       | ✅ intended for browser |
| Stellar public keys (G…)         | ✅             | ✅                      | ✅ safe to expose       |
| Contract addresses (C…)          | ✅             | ✅                      | ✅ safe to expose       |

**Summary:** only variables prefixed with `NEXT_PUBLIC_` belong in the browser.
Everything else is server-side only.

---

## 3. Audit findings

The following code paths were reviewed for secret leakage.

### 3.1 `sdk/src/client.ts` — ✅ Safe

`StellarClient` never accepts or stores a secret key.  It takes a
`StellarConfig` (URLs + network passphrase) and `ContractAddresses`, both of
which are safe to expose.  Signing is left entirely to the caller.

### 3.2 `sdk/src/payments.ts` — ⚠️ Requires server-side discipline

`releaseEscrow`, `refundEscrow`, and `disputeEscrow` accept a `Keypair` object
from the caller and call `transaction.sign(signer)` locally.

**Risk:** if these methods are called inside a Next.js API route that
accidentally reads a secret from a `NEXT_PUBLIC_` env var, the key becomes
visible to the browser via the bundle.

**Mitigation:** always source `Keypair` from `process.env.ADMIN_SECRET_KEY` (or
equivalent non-`NEXT_PUBLIC_` variable) in server-only code paths.  See
Section 5 for a safe server-side signing example.

### 3.3 `examples/usd-to-mxn.ts` and `examples/eur-to-usd.ts` — ✅ Safe

Both examples call `Keypair.random()` for demo accounts and document that a
real private key should come from an environment variable, not be hard-coded.
They are Node.js scripts (`require.main === module`) and cannot run in a
browser.

### 3.4 `examples/aid-disbursement.ts` — ✅ Safe

The CLI example uses a shell `$SOURCE_SECRET` variable and explicitly does not
call `Keypair.fromSecret` in application code.

### 3.5 `.env.example` — ✅ Safe (template only)

`ADMIN_SECRET_KEY=YOUR_ADMIN_SECRET_KEY_HERE` is a placeholder.  The file is
committed on purpose.  Ensure the real `.env` is listed in `.gitignore`.

### 3.6 `cli/src/` — ✅ Safe

The CLI runs exclusively in Node.js.  Secrets are consumed from environment
variables and never serialised into responses or log output.

### 3.7 `ui/` — ⚠️ Risk area (see Section 4)

The Next.js application must never import or instantiate `StellarClient` with a
signing key on the client side.  All signing must happen in API routes
(`/pages/api/` or `/app/api/`).

---

## 4. UI rules — what the browser can and cannot do

```
Browser (client component)
    │
    │  Can call
    ▼
Next.js API route  (/app/api/sign/route.ts)
    │
    │  Reads process.env.ADMIN_SECRET_KEY (server-only)
    │  Signs the transaction XDR
    │  Returns the signed XDR or hash to the browser
    ▼
Browser submits the signed XDR to Horizon
```

**The browser must never receive a secret key at any point in this flow.**

### Banned patterns

```ts
// ❌ DO NOT do this in any file that might be bundled for the browser
const keypair = Keypair.fromSecret(process.env.NEXT_PUBLIC_ADMIN_SECRET!);

// ❌ DO NOT do this in a React component or client-side hook
import { StellarPayments } from '@stellar-cross-border/sdk';
const payments = new StellarPayments(client);
await payments.releaseEscrow(id, Keypair.fromSecret(secret)); // secret in browser!

// ❌ DO NOT log or return secrets in API responses
console.log('Signing with', keypair.secret());
return NextResponse.json({ secret: keypair.secret() });
```

---

## 5. Correct server-side signing pattern

The following example shows how to sign a release-escrow transaction inside a
Next.js API route without exposing the key to the browser.

```ts
// app/api/release/route.ts  — server-only, never bundled for the browser
import { NextRequest, NextResponse } from 'next/server';
import { Keypair } from 'stellar-sdk';
import { StellarClient, StellarPayments } from '@stellar-cross-border/sdk';

// ✅ process.env variables without NEXT_PUBLIC_ prefix are server-only
const SIGNING_KEY = process.env.ADMIN_SECRET_KEY;

if (!SIGNING_KEY) {
  throw new Error('ADMIN_SECRET_KEY is not set.  Configure it in .env.local (server-only).');
}

// Build the client once at module load — safe because this module is never
// sent to the browser.
const client = new StellarClient(
  {
    horizonUrl:         process.env.HORIZON_URL!,
    sorobanRpcUrl:      process.env.SOROBAN_RPC_URL!,
    networkPassphrase:  process.env.NETWORK_PASSPHRASE!,
  },
  {
    escrow:     process.env.ESCROW_CONTRACT_ADDRESS!,
    rateOracle: process.env.RATE_ORACLE_CONTRACT_ADDRESS!,
    compliance: process.env.COMPLIANCE_CONTRACT_ADDRESS!,
  }
);

const payments = new StellarPayments(client);

export async function POST(req: NextRequest) {
  const { escrowId } = await req.json();

  // ✅ Keypair is created server-side, never leaves this function
  const signerKeypair = Keypair.fromSecret(SIGNING_KEY);

  const result = await payments.releaseEscrow(escrowId, signerKeypair, {
    feeBump: true,
  });

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  // ✅ Only the transaction hash is returned — no key material
  return NextResponse.json({ hash: result.hash });
}
```

---

## 6. Environment variable hygiene

1. Copy `.env.example` to `.env.local` (Next.js) or `.env` (Node.js CLI).
2. **Never commit `.env` or `.env.local`** — they must be in `.gitignore`.
3. CI/CD secrets must be injected through your platform's secret store
   (GitHub Actions secrets, AWS Secrets Manager, etc.), not committed to the
   repository.
4. Rotate `ADMIN_SECRET_KEY` immediately if it is ever accidentally committed or
   logged.
5. Use separate keypairs for testnet and mainnet; never reuse a mainnet key on
   testnet.

---

## 7. Multi-sig for high-value transactions

For production disbursements above your configured `MAX_TRANSACTION_AMOUNT`,
consider requiring multiple signers:

```ts
// After building the transaction:
transaction.sign(primaryKeypair);    // signing authority 1
transaction.sign(secondaryKeypair);  // signing authority 2 — from a separate HSM or vault
```

Set `REQUIRE_MULTISIG=true` and `MIN_SIGNATURES=2` in `.env` and enforce this
check in your API route before submitting.

---

## 8. Checklist before shipping

- [ ] No `S…` secret key appears anywhere in committed code or config.
- [ ] `.env` and `.env.local` are in `.gitignore`.
- [ ] All `Keypair.fromSecret` calls are in server-only files
      (API routes, CLI scripts, backend services).
- [ ] No `NEXT_PUBLIC_` variable holds a secret or API key.
- [ ] Transaction signing happens server-side; only the signed XDR or hash is
      sent to the browser.
- [ ] CI/CD pipeline reads secrets from the platform secret store, not from the
      repository.
- [ ] `ADMIN_SECRET_KEY` has been rotated since the last time anyone with access
      left the team.
