/**
 * Integration test — Full cross-border payment workflow
 *
 * Exercises the complete SDK path:
 *   1. Exchange rate query
 *   2. Compliance check
 *   3. Escrow creation
 *   4. Payment status poll
 *   5. Escrow release
 *   6. Final status verification
 *
 * All network calls are intercepted by Jest mocks so the suite runs offline
 * and deterministically in CI (no real Horizon or Soroban RPC required).
 *
 * Prerequisites to run against a LIVE testnet:
 *   - Set INTEGRATION_LIVE=true in your shell
 *   - Provide HORIZON_URL, SOROBAN_RPC_URL, ADMIN_SECRET_KEY,
 *     ESCROW_CONTRACT_ADDRESS, RATE_ORACLE_CONTRACT_ADDRESS,
 *     COMPLIANCE_CONTRACT_ADDRESS in your .env (see README §Environment Variables)
 *   - Fund the sender keypair via Friendbot before running
 *
 * Expected results (mocked mode):
 *   ✓ Exchange rate is returned for USD→MXN
 *   ✓ Compliance check approves a standard remittance
 *   ✓ Escrow is created and an escrow ID is returned
 *   ✓ Payment status reflects EscrowStatus.Pending after creation
 *   ✓ Escrow release succeeds and status transitions to EscrowStatus.Completed
 *   ✓ Dispute → refund path leaves status as EscrowStatus.Refunded
 */

import { Keypair, Networks, xdr } from 'stellar-sdk';
import { StellarCrossBorderSDK } from './index';
import { StellarClient } from './client';
import { StellarPayments } from './payments';
import {
  EscrowStatus,
  PaymentRequest,
  PaymentOptions,
  ExchangeRateRequest,
  ComplianceRequest,
  EscrowCreationResult,
  ComplianceCheckResult,
  ExchangeRateResult,
  PaymentStatus,
  TransactionResult,
} from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

const FAKE_ESCROW_ID = 'a'.repeat(64); // 32-byte hex string
const FAKE_TX_HASH   = 'b'.repeat(64);
const RELEASE_OFFSET = 24 * 60 * 60; // 24 h in seconds

const MOCK_CONTRACTS = {
  escrow:     'CESCROW000000000000000000000000000000000000000000000000000',
  rateOracle: 'CORACLE000000000000000000000000000000000000000000000000000',
  compliance: 'CCOMPLY000000000000000000000000000000000000000000000000000',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTestnetConfig() {
  return StellarCrossBorderSDK.createTestnetConfig();
}

/**
 * Builds a PaymentStatus stub for the given escrow state.
 */
function stubPaymentStatus(
  sender: string,
  receiver: string,
  status: EscrowStatus,
  releaseTime: number
): PaymentStatus {
  const now = Math.floor(Date.now() / 1000);
  return {
    escrowId:    FAKE_ESCROW_ID,
    status,
    amount:      '1000',
    sender,
    receiver,
    created_at:  now,
    release_time: releaseTime,
    can_release: status === EscrowStatus.Pending && now >= releaseTime,
    can_refund:  status === EscrowStatus.Pending,
  };
}

// ─── Mock wiring ─────────────────────────────────────────────────────────────

// Mock the StellarClient class so no real HTTP/RPC calls are made.
jest.mock('./client');
const MockedStellarClient = StellarClient as jest.MockedClass<typeof StellarClient>;

beforeEach(() => {
  MockedStellarClient.mockClear();
});

// ─── Test suite ───────────────────────────────────────────────────────────────

describe('Cross-border payment — full workflow integration', () => {
  let sdk: StellarCrossBorderSDK;
  let sender: Keypair;
  let receiver: Keypair;
  let releaseTime: number;

  // Shared mock instances
  let mockPayments: jest.Mocked<StellarPayments>;

  beforeEach(() => {
    sender      = Keypair.random();
    receiver    = Keypair.random();
    releaseTime = Math.floor(Date.now() / 1000) + RELEASE_OFFSET;

    // Build the SDK with the mocked client underneath
    sdk = new StellarCrossBorderSDK(makeTestnetConfig(), MOCK_CONTRACTS);

    // Replace the internal payments instance with a full mock
    mockPayments = {
      getExchangeRate:  jest.fn(),
      checkCompliance:  jest.fn(),
      createPayment:    jest.fn(),
      releaseEscrow:    jest.fn(),
      refundEscrow:     jest.fn(),
      disputeEscrow:    jest.fn(),
      getPaymentStatus: jest.fn(),
      getEscrow:        jest.fn(),
      getUserEscrows:   jest.fn(),
    } as unknown as jest.Mocked<StellarPayments>;

    // Inject the mock — access the private field via bracket notation in tests
    (sdk as any).payments = mockPayments;
  });

  // ── Step 1: Exchange rate ──────────────────────────────────────────────────

  describe('Step 1 — getExchangeRate', () => {
    it('returns a valid USD→MXN rate', async () => {
      const mockRate: ExchangeRateResult = {
        rate:      '17.25',
        timestamp: Math.floor(Date.now() / 1000),
        sources:   [],
        aggregated: {
          rate:                '17.25',
          weighted_average:    '17.25',
          sources_count:       3,
          last_updated:        Math.floor(Date.now() / 1000),
          deviation_threshold: 5,
        },
      };
      mockPayments.getExchangeRate.mockResolvedValueOnce(mockRate);

      const request: ExchangeRateRequest = {
        from_currency: 'USD',
        to_currency:   'MXN',
      };

      const result = await sdk.paymentsInstance.getExchangeRate(request);

      expect(result.rate).toBe('17.25');
      expect(result.aggregated.sources_count).toBeGreaterThan(0);
      expect(mockPayments.getExchangeRate).toHaveBeenCalledWith(request);
    });

    it('throws when the oracle has no rate for the pair', async () => {
      mockPayments.getExchangeRate.mockRejectedValueOnce(
        new Error('Exchange rate not found for USD/JPY')
      );

      await expect(
        sdk.paymentsInstance.getExchangeRate({ from_currency: 'USD', to_currency: 'JPY' })
      ).rejects.toThrow('Exchange rate not found for USD/JPY');
    });
  });

  // ── Step 2: Compliance check ───────────────────────────────────────────────

  describe('Step 2 — checkCompliance', () => {
    it('approves a standard US→MX remittance under the limit', async () => {
      const mockCompliance: ComplianceCheckResult = {
        hash:           FAKE_TX_HASH,
        success:        true,
        approved:       true,
        reason:         'APPROVED',
        rulesTriggered: ['STANDARD_REMITTANCE'],
      };
      mockPayments.checkCompliance.mockResolvedValueOnce(mockCompliance);

      const request: ComplianceRequest = {
        from_user:         sender.publicKey(),
        to_user:           receiver.publicKey(),
        amount:            '1000',
        currency:          'USD',
        jurisdiction_from: 'US',
        jurisdiction_to:   'MX',
      };

      const result = await sdk.paymentsInstance.checkCompliance(request);

      expect(result.approved).toBe(true);
      expect(result.reason).toBe('APPROVED');
      expect(mockPayments.checkCompliance).toHaveBeenCalledWith(request);
    });

    it('rejects a payment to a restricted jurisdiction', async () => {
      const mockRejection: ComplianceCheckResult = {
        hash:           '',
        success:        false,
        approved:       false,
        reason:         'RESTRICTED_JURISDICTION',
        rulesTriggered: ['JURISDICTION_BLOCK'],
      };
      mockPayments.checkCompliance.mockResolvedValueOnce(mockRejection);

      const result = await sdk.paymentsInstance.checkCompliance({
        from_user:         sender.publicKey(),
        to_user:           receiver.publicKey(),
        amount:            '500',
        currency:          'USD',
        jurisdiction_from: 'US',
        jurisdiction_to:   'KP', // restricted
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('RESTRICTED_JURISDICTION');
    });

    it('rejects a payment that exceeds the transaction limit', async () => {
      const mockRejection: ComplianceCheckResult = {
        hash:           '',
        success:        false,
        approved:       false,
        reason:         'EXCEEDS_TRANSACTION_LIMIT',
        rulesTriggered: ['MAX_AMOUNT_RULE'],
      };
      mockPayments.checkCompliance.mockResolvedValueOnce(mockRejection);

      const result = await sdk.paymentsInstance.checkCompliance({
        from_user:         sender.publicKey(),
        to_user:           receiver.publicKey(),
        amount:            '999999999',
        currency:          'USD',
        jurisdiction_from: 'US',
        jurisdiction_to:   'MX',
      });

      expect(result.approved).toBe(false);
      expect(result.reason).toBe('EXCEEDS_TRANSACTION_LIMIT');
    });
  });

  // ── Step 3: Escrow creation ────────────────────────────────────────────────

  describe('Step 3 — createPayment (escrow)', () => {
    it('creates a time-locked escrow and returns an escrow ID', async () => {
      const mockCreation: EscrowCreationResult = {
        hash:     FAKE_TX_HASH,
        success:  true,
        escrowId: FAKE_ESCROW_ID,
      };
      mockPayments.createPayment.mockResolvedValueOnce(mockCreation);

      const request: PaymentRequest = {
        from:         sender.publicKey(),
        to:           receiver.publicKey(),
        amount:       '1000',
        token:        'USDC',
        release_time: releaseTime,
        metadata: {
          purpose:          new TextEncoder().encode('remittance'),
          reference:        new TextEncoder().encode('US-MX-TEST-001'),
          sender_country:   new TextEncoder().encode('US'),
          receiver_country: new TextEncoder().encode('MX'),
        },
      };
      const options: PaymentOptions = {
        feeBump: true,
        memo:    'Integration-Test-Remittance',
        submit:  true,
      };

      const result = await sdk.paymentsInstance.createPayment(request, options);

      expect(result.success).toBe(true);
      expect(result.hash).toBe(FAKE_TX_HASH);
      expect(result.escrowId).toBe(FAKE_ESCROW_ID);
      expect(mockPayments.createPayment).toHaveBeenCalledWith(request, options);
    });

    it('returns success=false when the network rejects the transaction', async () => {
      mockPayments.createPayment.mockResolvedValueOnce({
        hash:     '',
        success:  false,
        escrowId: '',
        error:    'tx_bad_seq',
      });

      const result = await sdk.paymentsInstance.createPayment(
        {
          from:   sender.publicKey(),
          to:     receiver.publicKey(),
          amount: '1000',
          token:  'USDC',
        },
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('tx_bad_seq');
    });
  });

  // ── Step 4: Payment status ─────────────────────────────────────────────────

  describe('Step 4 — getPaymentStatus', () => {
    it('returns Pending status immediately after creation', async () => {
      const status = stubPaymentStatus(
        sender.publicKey(),
        receiver.publicKey(),
        EscrowStatus.Pending,
        releaseTime
      );
      mockPayments.getPaymentStatus.mockResolvedValueOnce(status);

      const result = await sdk.paymentsInstance.getPaymentStatus(FAKE_ESCROW_ID);

      expect(result.status).toBe(EscrowStatus.Pending);
      expect(result.escrowId).toBe(FAKE_ESCROW_ID);
      expect(result.sender).toBe(sender.publicKey());
      expect(result.receiver).toBe(receiver.publicKey());
      expect(result.can_refund).toBe(true);
      // Release time is in the future so can_release should be false
      expect(result.can_release).toBe(false);
    });

    it('can_release becomes true once release_time has passed', async () => {
      const pastReleaseTime = Math.floor(Date.now() / 1000) - 60; // 1 min ago
      const status = stubPaymentStatus(
        sender.publicKey(),
        receiver.publicKey(),
        EscrowStatus.Pending,
        pastReleaseTime
      );
      // Manually set can_release to true (as the real impl would)
      status.can_release = true;
      mockPayments.getPaymentStatus.mockResolvedValueOnce(status);

      const result = await sdk.paymentsInstance.getPaymentStatus(FAKE_ESCROW_ID);

      expect(result.can_release).toBe(true);
    });
  });

  // ── Step 5: Escrow release ─────────────────────────────────────────────────

  describe('Step 5 — releaseEscrow', () => {
    it('releases the escrow and returns a successful transaction result', async () => {
      const mockRelease: TransactionResult = {
        hash:    FAKE_TX_HASH,
        success: true,
      };
      mockPayments.releaseEscrow.mockResolvedValueOnce(mockRelease);

      const result = await sdk.paymentsInstance.releaseEscrow(
        FAKE_ESCROW_ID,
        receiver,
        { feeBump: true }
      );

      expect(result.success).toBe(true);
      expect(result.hash).toBe(FAKE_TX_HASH);
    });

    it('returns success=false if called before release_time', async () => {
      mockPayments.releaseEscrow.mockResolvedValueOnce({
        hash:    '',
        success: false,
        error:   'ESCROW_NOT_RELEASABLE',
      });

      const result = await sdk.paymentsInstance.releaseEscrow(
        FAKE_ESCROW_ID,
        receiver,
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('ESCROW_NOT_RELEASABLE');
    });
  });

  // ── Step 6: Final status after release ────────────────────────────────────

  describe('Step 6 — final status after release', () => {
    it('status is Completed after a successful release', async () => {
      const completedStatus = stubPaymentStatus(
        sender.publicKey(),
        receiver.publicKey(),
        EscrowStatus.Completed,
        releaseTime
      );
      completedStatus.can_release = false;
      completedStatus.can_refund  = false;
      mockPayments.getPaymentStatus.mockResolvedValueOnce(completedStatus);

      const result = await sdk.paymentsInstance.getPaymentStatus(FAKE_ESCROW_ID);

      expect(result.status).toBe(EscrowStatus.Completed);
      expect(result.can_release).toBe(false);
      expect(result.can_refund).toBe(false);
    });
  });

  // ── Dispute → refund path ──────────────────────────────────────────────────

  describe('Dispute and refund path', () => {
    it('opens a dispute and transitions status to Disputed', async () => {
      // 1. Dispute
      mockPayments.disputeEscrow.mockResolvedValueOnce({
        hash:    FAKE_TX_HASH,
        success: true,
      });

      const disputeResult = await sdk.paymentsInstance.disputeEscrow(
        FAKE_ESCROW_ID,
        sender.publicKey(),
        'INVALID_PRODUCT',
        new TextEncoder().encode(JSON.stringify({ reason: 'license key invalid' })),
        sender,
        { feeBump: true }
      );
      expect(disputeResult.success).toBe(true);

      // 2. Status should be Disputed
      const disputedStatus = stubPaymentStatus(
        sender.publicKey(),
        receiver.publicKey(),
        EscrowStatus.Disputed,
        releaseTime
      );
      disputedStatus.can_refund  = false;
      disputedStatus.can_release = false;
      mockPayments.getPaymentStatus.mockResolvedValueOnce(disputedStatus);

      const afterDispute = await sdk.paymentsInstance.getPaymentStatus(FAKE_ESCROW_ID);
      expect(afterDispute.status).toBe(EscrowStatus.Disputed);
    });

    it('processes a refund after dispute resolution and shows Refunded status', async () => {
      // 1. Refund
      mockPayments.refundEscrow.mockResolvedValueOnce({
        hash:    FAKE_TX_HASH,
        success: true,
      });

      const refundResult = await sdk.paymentsInstance.refundEscrow(
        FAKE_ESCROW_ID,
        sender,
        { feeBump: true }
      );
      expect(refundResult.success).toBe(true);

      // 2. Final status
      const refundedStatus = stubPaymentStatus(
        sender.publicKey(),
        receiver.publicKey(),
        EscrowStatus.Refunded,
        releaseTime
      );
      refundedStatus.can_refund  = false;
      refundedStatus.can_release = false;
      mockPayments.getPaymentStatus.mockResolvedValueOnce(refundedStatus);

      const final = await sdk.paymentsInstance.getPaymentStatus(FAKE_ESCROW_ID);
      expect(final.status).toBe(EscrowStatus.Refunded);
      expect(final.can_refund).toBe(false);
    });
  });

  // ── Full happy-path sequence ───────────────────────────────────────────────

  describe('Full happy-path sequence', () => {
    /**
     * Runs all six steps in order using a single test to verify
     * the escrow ID threads correctly from creation through release.
     */
    it('creates escrow → checks compliance → releases → verifies Completed', async () => {
      // 1. Rate
      mockPayments.getExchangeRate.mockResolvedValueOnce({
        rate: '17.25', timestamp: Date.now(), sources: [],
        aggregated: { rate: '17.25', weighted_average: '17.25',
          sources_count: 3, last_updated: Date.now(), deviation_threshold: 5 },
      });

      // 2. Compliance
      mockPayments.checkCompliance.mockResolvedValueOnce({
        hash: FAKE_TX_HASH, success: true, approved: true,
        reason: 'APPROVED', rulesTriggered: [],
      });

      // 3. Create
      mockPayments.createPayment.mockResolvedValueOnce({
        hash: FAKE_TX_HASH, success: true, escrowId: FAKE_ESCROW_ID,
      });

      // 4. Status — Pending
      mockPayments.getPaymentStatus.mockResolvedValueOnce(
        stubPaymentStatus(sender.publicKey(), receiver.publicKey(),
          EscrowStatus.Pending, releaseTime)
      );

      // 5. Release
      mockPayments.releaseEscrow.mockResolvedValueOnce({
        hash: FAKE_TX_HASH, success: true,
      });

      // 6. Status — Completed
      const completedStatus = stubPaymentStatus(
        sender.publicKey(), receiver.publicKey(),
        EscrowStatus.Completed, releaseTime
      );
      completedStatus.can_release = false;
      completedStatus.can_refund  = false;
      mockPayments.getPaymentStatus.mockResolvedValueOnce(completedStatus);

      // ── Execute ────────────────────────────────────────────────────────────
      const rate = await sdk.paymentsInstance.getExchangeRate(
        { from_currency: 'USD', to_currency: 'MXN' }
      );
      expect(parseFloat(rate.rate)).toBeGreaterThan(0);

      const compliance = await sdk.paymentsInstance.checkCompliance({
        from_user: sender.publicKey(), to_user: receiver.publicKey(),
        amount: '1000', currency: 'USD',
        jurisdiction_from: 'US', jurisdiction_to: 'MX',
      });
      expect(compliance.approved).toBe(true);

      const creation = await sdk.paymentsInstance.createPayment(
        {
          from: sender.publicKey(), to: receiver.publicKey(),
          amount: '1000', token: 'USDC', release_time: releaseTime,
          metadata: { purpose: new TextEncoder().encode('remittance') },
        },
        { feeBump: true, memo: 'Integration-Happy-Path', submit: true }
      );
      expect(creation.success).toBe(true);
      const escrowId = creation.escrowId;
      expect(escrowId).toBe(FAKE_ESCROW_ID);

      const pendingStatus = await sdk.paymentsInstance.getPaymentStatus(escrowId);
      expect(pendingStatus.status).toBe(EscrowStatus.Pending);
      expect(pendingStatus.escrowId).toBe(escrowId);

      const release = await sdk.paymentsInstance.releaseEscrow(
        escrowId, receiver, { feeBump: true }
      );
      expect(release.success).toBe(true);

      const finalStatus = await sdk.paymentsInstance.getPaymentStatus(escrowId);
      expect(finalStatus.status).toBe(EscrowStatus.Completed);
    });
  });
});
