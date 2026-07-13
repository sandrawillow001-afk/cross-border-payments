/**
 * event-driven-payment.ts
 *
 * Demonstrates both ways to receive asynchronous transaction lifecycle events
 * from the Stellar cross-border SDK:
 *
 *   1. Event emitter  — sdk.on('confirmed', handler)
 *   2. Callback props — new StellarCrossBorderSDK(config, contracts, { onConfirmed })
 *
 * Available events
 * ────────────────
 *   submitted       – transaction XDR has been broadcast to Horizon
 *   confirmed       – transaction was included in a ledger successfully
 *   failed          – transaction was rejected or timed out
 *   escrow:created  – new escrow created on-chain
 *   escrow:released – escrow funds released to receiver
 *   escrow:refunded – escrow funds returned to sender
 *   escrow:disputed – dispute raised against an escrow
 */

import StellarCrossBorderSDK, { Keypair } from '@stellar-cross-border/sdk';
import type {
  TransactionSubmittedEvent,
  TransactionConfirmedEvent,
  TransactionFailedEvent,
  EscrowCreatedEvent,
  EscrowReleasedEvent,
  SDKCallbacks,
} from '@stellar-cross-border/sdk';

// ─── Shared configuration ─────────────────────────────────────────────────────

const config = StellarCrossBorderSDK.createTestnetConfig();
const contracts = {
  escrow:     'ESCROW_CONTRACT_ADDRESS_HERE',
  rateOracle: 'RATE_ORACLE_CONTRACT_ADDRESS_HERE',
  compliance: 'COMPLIANCE_CONTRACT_ADDRESS_HERE',
};

// ─── Example 1: Event emitter ─────────────────────────────────────────────────
//
// Attach listeners with sdk.on() after construction. Useful when you want to
// centralise logging or wire different subsystems independently.

async function runEventEmitterExample() {
  console.log('\n── Example 1: Event emitter ──────────────────────────────────\n');

  const sdk = new StellarCrossBorderSDK(config, contracts);

  // Wire up listeners — all are fully typed
  sdk.on('submitted', ({ hash, timestamp }: TransactionSubmittedEvent) => {
    console.log(`[submitted]  hash=${hash}  time=${new Date(timestamp).toISOString()}`);
  });

  sdk.on('confirmed', ({ hash }: TransactionConfirmedEvent) => {
    console.log(`[confirmed]  hash=${hash}`);
  });

  sdk.on('failed', ({ hash, error }: TransactionFailedEvent) => {
    console.error(`[failed]     hash=${hash}  error=${error}`);
  });

  sdk.on('escrow:created', ({ escrowId, hash, request }: EscrowCreatedEvent) => {
    console.log(`[escrow:created]   id=${escrowId}  hash=${hash}`);
    console.log(`                   sender=${request.from}  receiver=${request.to}`);
    // Typical use: persist the escrowId to your database here
  });

  sdk.on('escrow:released', ({ escrowId, hash }: EscrowReleasedEvent) => {
    console.log(`[escrow:released]  id=${escrowId}  hash=${hash}`);
    // Typical use: notify the receiver that funds are available
  });

  sdk.on('escrow:refunded', ({ escrowId, hash }) => {
    console.log(`[escrow:refunded]  id=${escrowId}  hash=${hash}`);
  });

  sdk.on('escrow:disputed', ({ escrowId, challenger, reason }) => {
    console.warn(`[escrow:disputed]  id=${escrowId}  challenger=${challenger}  reason=${reason}`);
    // Typical use: open a support ticket or trigger manual review
  });

  // One-shot listener: fires once, then auto-removes itself
  sdk.once('confirmed', ({ hash }) => {
    console.log(`[once:confirmed] First confirmation received — hash=${hash}`);
  });

  await runPaymentFlow(sdk, 'event-emitter');
}

// ─── Example 2: Callback props ────────────────────────────────────────────────
//
// Pass callbacks directly to the constructor. Handy when you prefer co-located
// config or when you only need a subset of events without managing listeners.

async function runCallbackPropsExample() {
  console.log('\n── Example 2: Callback props ─────────────────────────────────\n');

  const callbacks: SDKCallbacks = {
    onSubmitted: ({ hash, timestamp }) => {
      console.log(`[onSubmitted]  hash=${hash}  time=${new Date(timestamp).toISOString()}`);
    },

    onConfirmed: ({ hash }) => {
      console.log(`[onConfirmed]  hash=${hash}`);
      // Typical use: update your UI / order management system
    },

    onFailed: ({ hash, error }) => {
      console.error(`[onFailed]     hash=${hash}  error=${error}`);
      // Typical use: trigger retry logic or alert the operator
    },

    onEscrowCreated: ({ escrowId, request }) => {
      console.log(`[onEscrowCreated]   id=${escrowId}`);
      console.log(`                    amount=${request.amount}  token=${request.token}`);
    },

    onEscrowReleased: ({ escrowId }) => {
      console.log(`[onEscrowReleased]  id=${escrowId}`);
    },
  };

  const sdk = new StellarCrossBorderSDK(config, contracts, callbacks);

  await runPaymentFlow(sdk, 'callback-props');
}

// ─── Example 3: Removing a listener ──────────────────────────────────────────
//
// Use sdk.off() to clean up listeners when a component unmounts or a workflow
// step completes.

async function runRemoveListenerExample() {
  console.log('\n── Example 3: Removing a listener ────────────────────────────\n');

  const sdk = new StellarCrossBorderSDK(config, contracts);

  const onConfirmed = ({ hash }: TransactionConfirmedEvent) => {
    console.log(`[confirmed]  hash=${hash}`);
  };

  sdk.on('confirmed', onConfirmed);
  console.log('Listener registered.');

  // … later, when no longer needed:
  sdk.off('confirmed', onConfirmed);
  console.log('Listener removed. No further confirmed events will be handled.');
}

// ─── Shared payment flow ──────────────────────────────────────────────────────

async function runPaymentFlow(sdk: StellarCrossBorderSDK, label: string) {
  const sender   = Keypair.random();
  const receiver = Keypair.random();

  console.log(`[${label}] sender:   ${sender.publicKey()}`);
  console.log(`[${label}] receiver: ${receiver.publicKey()}\n`);

  try {
    // Fund accounts on testnet
    console.log(`[${label}] Funding testnet accounts...`);
    await sdk.clientInstance.fundTestnetAccount(sender.publicKey());
    await sdk.clientInstance.fundTestnetAccount(receiver.publicKey());

    // Create escrow — events fire automatically:
    //   submitted  → when XDR is broadcast
    //   confirmed  → when ledger includes the tx
    //   escrow:created → when escrowId is extracted from the result
    console.log(`\n[${label}] Creating escrow payment...`);
    const paymentResult = await sdk.paymentsInstance.createPayment(
      {
        from:         sender.publicKey(),
        to:           receiver.publicKey(),
        amount:       '500',
        token:        'USDC',
        release_time: Math.floor(Date.now() / 1000) + 3600, // 1 hour
        metadata:     {},
      },
      { feeBump: true, memo: 'event-demo', submit: true }
    );

    if (!paymentResult.success) {
      console.error(`[${label}] Payment failed: ${paymentResult.error}`);
      return;
    }

    console.log(`\n[${label}] Escrow created: ${paymentResult.escrowId}`);

    // Release escrow — events fire automatically:
    //   submitted       → when XDR is broadcast
    //   confirmed       → when ledger includes the tx
    //   escrow:released → after confirmed
    console.log(`\n[${label}] Releasing escrow...`);
    const releaseResult = await sdk.paymentsInstance.releaseEscrow(
      paymentResult.escrowId,
      receiver,
      { feeBump: true }
    );

    if (!releaseResult.success) {
      console.error(`[${label}] Release failed: ${releaseResult.error}`);
      return;
    }

    console.log(`\n[${label}] ✅ Flow complete. Release tx: ${releaseResult.hash}`);

  } catch (err) {
    console.error(`[${label}] Unexpected error:`, err);
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main() {
  try {
    await runEventEmitterExample();
    await runCallbackPropsExample();
    await runRemoveListenerExample();
  } catch (err) {
    console.error('Example failed:', err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export {
  runEventEmitterExample,
  runCallbackPropsExample,
  runRemoveListenerExample,
};
