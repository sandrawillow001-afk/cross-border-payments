import { useEffect, useCallback, useReducer } from 'react';
import { Keypair } from 'stellar-sdk';
import { StellarCrossBorderSDK } from '@stellar-cross-border/sdk';
import {
  PaymentStatus,
  EscrowStatus,
  PaymentRequest,
  PaymentOptions,
  ExchangeRateRequest,
  ComplianceRequest,
  EscrowCreationResult,
  TransactionResult,
  ExchangeRateResult,
  ComplianceCheckResult,
} from '@stellar-cross-border/sdk';

export interface UseStellarPaymentOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export interface StellarPaymentState {
  loading: boolean;
  error: string | null;
  paymentStatus: PaymentStatus | null;
  exchangeRate: ExchangeRateResult | null;
  complianceCheck: ComplianceCheckResult | null;
}

export interface StellarPaymentActions {
  createPayment: (request: PaymentRequest, options?: PaymentOptions) => Promise<EscrowCreationResult>;
  releaseEscrow: (escrowId: string, signer: Keypair, options?: PaymentOptions) => Promise<TransactionResult>;
  refundEscrow: (escrowId: string, signer: Keypair, options?: PaymentOptions) => Promise<TransactionResult>;
  disputeEscrow: (escrowId: string, challenger: string, reason: string, evidence: Uint8Array, signer: Keypair, options?: PaymentOptions) => Promise<TransactionResult>;
  getExchangeRate: (request: ExchangeRateRequest) => Promise<ExchangeRateResult>;
  checkCompliance: (request: ComplianceRequest) => Promise<ComplianceCheckResult>;
  getPaymentStatus: (escrowId: string) => Promise<PaymentStatus>;
  refreshStatus: () => Promise<void>;
  clearError: () => void;
}

type StateAction =
  | { type: 'START' }
  | { type: 'DONE' }
  | { type: 'FAIL'; error: string }
  | { type: 'SET_PAYMENT_STATUS'; paymentStatus: PaymentStatus }
  | { type: 'SET_EXCHANGE_RATE'; exchangeRate: ExchangeRateResult }
  | { type: 'SET_COMPLIANCE_CHECK'; complianceCheck: ComplianceCheckResult }
  | { type: 'CLEAR_ERROR' };

const initialState: StellarPaymentState = {
  loading: false,
  error: null,
  paymentStatus: null,
  exchangeRate: null,
  complianceCheck: null,
};

function stateReducer(state: StellarPaymentState, action: StateAction): StellarPaymentState {
  switch (action.type) {
    case 'START':
      return { ...state, loading: true, error: null };
    case 'DONE':
      return { ...state, loading: false };
    case 'FAIL':
      return { ...state, loading: false, error: action.error };
    case 'SET_PAYMENT_STATUS':
      return { ...state, paymentStatus: action.paymentStatus };
    case 'SET_EXCHANGE_RATE':
      return { ...state, exchangeRate: action.exchangeRate };
    case 'SET_COMPLIANCE_CHECK':
      return { ...state, complianceCheck: action.complianceCheck };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    default:
      return state;
  }
}

export const useStellarPayment = (
  sdk: StellarCrossBorderSDK,
  escrowId?: string,
  options: UseStellarPaymentOptions = {}
): StellarPaymentState & StellarPaymentActions => {
  const { autoRefresh = true, refreshInterval = 30000 } = options;

  const [state, dispatch] = useReducer(stateReducer, initialState);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  const run = useCallback(async <T,>(
    fn: () => Promise<T>,
    onSuccess?: (result: T) => void,
  ): Promise<T> => {
    dispatch({ type: 'START' });
    try {
      const result = await fn();
      onSuccess?.(result);
      dispatch({ type: 'DONE' });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      dispatch({ type: 'FAIL', error: message });
      throw err;
    }
  }, []);

  const getPaymentStatus = useCallback(async (id: string): Promise<PaymentStatus> => {
    return run(
      () => sdk.paymentsInstance.getPaymentStatus(id),
      (status) => dispatch({ type: 'SET_PAYMENT_STATUS', paymentStatus: status }),
    );
  }, [sdk, run]);

  const createPayment = useCallback(async (
    request: PaymentRequest,
    options?: PaymentOptions
  ): Promise<EscrowCreationResult> => {
    return run(async () => {
      const result = await sdk.paymentsInstance.createPayment(request, options);
      
      if (result.success && result.escrowId) {
        const status = await sdk.paymentsInstance.getPaymentStatus(result.escrowId);
        dispatch({ type: 'SET_PAYMENT_STATUS', paymentStatus: status });
      }
      
      return result;
    }, undefined);
  }, [sdk, run]);

  const releaseEscrow = useCallback(async (
    id: string,
    signer: Keypair,
    options?: PaymentOptions
  ): Promise<TransactionResult> => {
    return run(async () => {
      const result = await sdk.paymentsInstance.releaseEscrow(id, signer, options);
      
      if (result.success) {
        const status = await sdk.paymentsInstance.getPaymentStatus(id);
        dispatch({ type: 'SET_PAYMENT_STATUS', paymentStatus: status });
      }
      
      return result;
    }, undefined);
  }, [sdk, run]);

  const refundEscrow = useCallback(async (
    id: string,
    signer: Keypair,
    options?: PaymentOptions
  ): Promise<TransactionResult> => {
    return run(async () => {
      const result = await sdk.paymentsInstance.refundEscrow(id, signer, options);
      
      if (result.success) {
        const status = await sdk.paymentsInstance.getPaymentStatus(id);
        dispatch({ type: 'SET_PAYMENT_STATUS', paymentStatus: status });
      }
      
      return result;
    }, undefined);
  }, [sdk, run]);

  const disputeEscrow = useCallback(async (
    id: string,
    challenger: string,
    reason: string,
    evidence: Uint8Array,
    signer: Keypair,
    options?: PaymentOptions
  ): Promise<TransactionResult> => {
    return run(async () => {
      const result = await sdk.paymentsInstance.disputeEscrow(
        id, 
        challenger, 
        reason, 
        evidence, 
        signer, 
        options
      );
      
      if (result.success) {
        const status = await sdk.paymentsInstance.getPaymentStatus(id);
        dispatch({ type: 'SET_PAYMENT_STATUS', paymentStatus: status });
      }
      
      return result;
    }, undefined);
  }, [sdk, run]);

  const getExchangeRate = useCallback(async (
    request: ExchangeRateRequest
  ): Promise<ExchangeRateResult> => {
    return run(
      () => sdk.paymentsInstance.getExchangeRate(request),
      (result) => dispatch({ type: 'SET_EXCHANGE_RATE', exchangeRate: result }),
    );
  }, [sdk, run]);

  const checkCompliance = useCallback(async (
    request: ComplianceRequest
  ): Promise<ComplianceCheckResult> => {
    return run(
      () => sdk.paymentsInstance.checkCompliance(request),
      (result) => dispatch({ type: 'SET_COMPLIANCE_CHECK', complianceCheck: result }),
    );
  }, [sdk, run]);

  const refreshStatus = useCallback(async () => {
    if (escrowId) {
      await getPaymentStatus(escrowId);
    }
  }, [escrowId, getPaymentStatus]);

  // Auto-refresh payment status for pending escrows
  useEffect(() => {
    if (!autoRefresh || !escrowId || !state.paymentStatus) {
      return;
    }

    if (state.paymentStatus.status === EscrowStatus.Pending) {
      const interval = setInterval(() => {
        refreshStatus();
      }, refreshInterval);

      return () => clearInterval(interval);
    }
  }, [autoRefresh, escrowId, state.paymentStatus, refreshInterval, refreshStatus]);

  // Initial load of payment status if escrowId is provided
  useEffect(() => {
    if (escrowId) {
      getPaymentStatus(escrowId);
    }
  }, [escrowId, getPaymentStatus]);

  return {
    ...state,
    createPayment,
    releaseEscrow,
    refundEscrow,
    disputeEscrow,
    getExchangeRate,
    checkCompliance,
    getPaymentStatus,
    refreshStatus,
    clearError,
  };
};

export default useStellarPayment;
