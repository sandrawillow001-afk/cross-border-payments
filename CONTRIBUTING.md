# Contributing to Stellar Cross-Border Payments SDK

Thank you for taking the time to contribute. This guide covers everything you
need to get from idea to merged pull request.

---

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Ways to Contribute](#ways-to-contribute)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Commit & Branch Conventions](#commit--branch-conventions)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Requirements](#testing-requirements)
- [Documentation](#documentation)
- [Reporting Bugs](#reporting-bugs)
- [Requesting Features](#requesting-features)
- [Security Vulnerabilities](#security-vulnerabilities)

---

## Code of Conduct

This project follows the
[Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
By participating you agree to uphold this code. Please report unacceptable
behaviour to the maintainers via GitHub Issues or the contact listed in
`package.json`.

---

## Ways to Contribute

| Type | How |
|---|---|
| Bug report | Open a GitHub Issue with the `bug` label |
| Feature request | Open a GitHub Issue with the `enhancement` label |
| Documentation fix | Open a PR directly (no issue required for small fixes) |
| Code contribution | Fork → branch → PR (see workflow below) |
| Security issue | **Do not** open a public issue — see [Security Vulnerabilities](#security-vulnerabilities) |

---

## Getting Started

### Prerequisites

- **Node.js** 18+
- **npm** 8+ (workspace support required)
- **Rust** 1.78+ with the `wasm32-unknown-unknown` target
- **Stellar CLI** 21+

```bash
# Clone your fork
git clone https://github.com/<your-username>/stellar-cross-border-payments-sdk.git
cd stellar-cross-border-payments-sdk

# Add upstream remote
git remote add upstream https://github.com/stellar-cross-border/stellar-cross-border-payments-sdk.git

# Install dependencies
npm install

# Install Rust WASM target
rustup target add wasm32-unknown-unknown

# Copy env template
cp .env.example .env
# Edit .env — at minimum set ADMIN_SECRET_KEY and the three contract addresses
```

---

## Development Workflow

```
main (protected)
 └── fix-<issue>      bug fixes
 └── feat/<slug>      new features
 └── docs/<slug>      documentation-only changes
 └── chore/<slug>     tooling, deps, CI
```

1. **Sync with upstream** before starting any work:

   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Create a branch** off `main`:

   ```bash
   git checkout -b feat/my-feature
   ```

3. **Make changes**, following the [Coding Standards](#coding-standards) below.

4. **Run the full verification suite** before pushing:

   ```bash
   # Type-check all packages
   npm run type-check

   # Lint
   npm run lint

   # Tests
   npm test          # SDK + CLI Jest suites
   cargo test        # Soroban contract tests

   # Build (confirms nothing is broken end-to-end)
   npm run build:full
   ```

5. **Push and open a PR** against `main`.

---

## Commit & Branch Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short summary>

[optional body]

[optional footer — e.g. Closes #43]
```

**Types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`

**Scopes (optional):** `sdk`, `cli`, `ui`, `contracts`, `docs`, `deps`

Examples:

```
feat(sdk): add multi-signature payment support
fix(cli): handle empty CSV rows gracefully  Closes #38
docs: add LICENSE and CONTRIBUTING  Closes #43
chore(deps): bump stellar-sdk to 12.1.0
```

Keep the subject line under 72 characters. Use the body to explain *why*, not
*what* — the diff shows what changed.

---

## Pull Request Process

1. **Title** must follow the commit convention above (the merge commit will
   use it).
2. **Link the issue** with `Closes #<n>` in the PR description or body.
3. **Fill in all checklist items** in the PR template.
4. **Pass all CI checks** — the GitHub Actions workflow runs lint, type-check,
   Jest, and `cargo test` on every PR.
5. **At least one maintainer review** is required before merge.
6. Prefer **squash-and-merge** for single-commit features; **merge commit** for
   multi-commit feature branches where individual history is meaningful.

### PR checklist

```
- [ ] Branch is up-to-date with main
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] `cargo test` passes (if contracts were modified)
- [ ] Documentation updated (README, JSDoc, or relevant .md)
- [ ] Issue number referenced with `Closes #<n>`
```

---

## Coding Standards

### TypeScript (SDK, CLI, UI)

- Strict TypeScript — `"strict": true` in all `tsconfig.json` files.
- ESLint + Prettier are configured at the workspace root. Run `npm run lint`
  and fix all warnings before submitting.
- Prefer named exports over default exports.
- Use branded types (`StellarAddress`, `AmountString`) for validated values;
  never pass raw strings where a validated type is expected.
- All public API functions must have JSDoc comments with `@param` and
  `@returns` tags.
- No `any` — use `unknown` and narrow explicitly.

### Rust (Soroban contracts)

- Run `cargo fmt` before committing.
- Run `cargo clippy -- -D warnings`; fix all warnings.
- Contract storage keys must be `Symbol` values defined as constants.
- Every public contract function must have a `#[doc]` comment.

---

## Testing Requirements

| Layer | Command | Minimum coverage expectation |
|---|---|---|
| Soroban contracts | `cargo test` | All public functions |
| TypeScript SDK | `npm run test:sdk` | New code paths covered |
| CLI | `npm run test:cli` | New commands / parsers covered |

- Tests live alongside the code they test (`*.test.ts` / `#[cfg(test)]`).
- Use Jest for TypeScript unit tests; avoid testing Stellar network calls
  directly — mock the `StellarClient` instead.
- Property-based tests are encouraged for parsers and validation logic.

---

## Documentation

- API changes must update the relevant section of `README.md` and any JSDoc
  in the source.
- New environment variables must be added to `.env.example` *and* to the
  **Environment Variables** section of `README.md`.
- New CLI commands or flags must be reflected in the **CLI Tool** section of
  `README.md`.
- Significant architecture changes should include or update a file under
  `docs/`.

---

## Reporting Bugs

Open a [GitHub Issue](https://github.com/stellar-cross-border/stellar-cross-border-payments-sdk/issues)
with the `bug` label and include:

- **SDK / CLI version** (`npm list @stellar-cross-border/sdk` or `stellar-payout --version`)
- **Node.js version** (`node --version`)
- **Rust / Stellar CLI version** if relevant
- **Steps to reproduce** — minimal, runnable example preferred
- **Expected behaviour**
- **Actual behaviour** — full error message and stack trace
- **Network** — testnet or mainnet

---

## Requesting Features

Open a [GitHub Issue](https://github.com/stellar-cross-border/stellar-cross-border-payments-sdk/issues)
with the `enhancement` label. Include:

- The problem you are trying to solve (not just the solution you have in mind)
- Any alternative approaches you considered
- Whether you are willing to implement it

---

## Security Vulnerabilities

**Do not open a public GitHub Issue for security vulnerabilities.**

Email the maintainers directly (see `package.json` → `repository` for the
project URL, then check the repository's Security tab for the security policy
and contact details). We aim to acknowledge reports within 48 hours and
provide a fix or mitigation within 14 days for critical issues.
