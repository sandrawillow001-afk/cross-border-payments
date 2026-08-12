# Stellar Level 1 — Freighter Wallet Frontend

A reference frontend that satisfies the **Stellar Level 1** requirements.

## Requirements coverage

1. **Wallet Setup**
   - Uses the **Freighter** wallet (`@stellar/freighter-api`)
   - Configured for **Stellar Testnet** (passphrase + Horizon URL in `src/stellar.ts`)

2. **Wallet Connection**
   - `Connect Freighter` → `requestAccess()` (`src/wallet.ts`)
   - `Disconnect` → `setAllowed(false)` + clears local state

3. **Balance Handling**
   - Fetches the connected wallet's **XLM balance** via Horizon (`getXlmBalance`)
   - Displays it clearly in the UI (Balance card)

4. **Transaction Flow**
   - Sends an **XLM payment on Testnet** (`buildPaymentXdr` → `signWithFreighter` → `submitSignedTx`)
   - Shows feedback: **success** (with tx hash + explorer link) or **failure** (error message)

5. **Development Standards**
   - Clean component UI (`src/App.tsx`), wallet integration (`src/wallet.ts`),
     balance fetch + transaction logic (`src/stellar.ts`), and error handling throughout.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
# or
npm run build    # production build -> dist/
```

Install the **Freighter** browser extension from https://www.freighter.app/
and set its network to **Testnet**. Fund your testnet account with Friendbot
(button in the UI) before sending XLM.
