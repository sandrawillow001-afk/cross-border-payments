import React, { useState, useCallback, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'react-hot-toast';
import {
  ArrowRight,
  Clock,
  Shield,
  DollarSign,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { StellarCrossBorderSDK } from '@stellar-cross-border/sdk';
import { PaymentRequest, PaymentOptions } from '@stellar-cross-border/sdk';
import {
  AddressValidator,
  defaultStellarAddressValidator,
} from '@stellar-cross-border/sdk';
import {
  TokenEntry,
  TokenMetadataSource,
  DEFAULT_TOKENS,
  fetchTokenList,
} from '../lib/tokens';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// ── Whitelisted tokens shown in the dropdown ────────────────────────────────
const COMMON_TOKENS = [
  { symbol: 'XLM',  name: 'Stellar Lumens', contract: 'native' },
  { symbol: 'USDC', name: 'USD Coin',        contract: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFLBKYXRH7CL5BJM4A3' },
  { symbol: 'EURC', name: 'Euro Coin',       contract: 'GDZQJFSYNKSWDYM7KKEGZUPXNBNLAO5FQMJGFJFD7ZMPGA2U6WMR5VY' },
  { symbol: 'yXLM', name: 'Wrapped XLM',     contract: 'GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55' },
] as const;

// ── Form field types ────────────────────────────────────────────────────────
interface PaymentFormData {
  from: string;
  to: string;
  amount: string;
  /** Either a contract address / 'native', or CUSTOM_ASSET_VALUE sentinel. */
  token: string;
  /** Only used when token === CUSTOM_ASSET_VALUE */
  customAssetCode:   string;
  /** Only used when token === CUSTOM_ASSET_VALUE */
  customAssetIssuer: string;
  releaseTime: string;
  memo?: string;
  feeBump: boolean;
}

/**
 * Signature for an address-validation callback.
 *
 * Returning `true` means the address is valid; returning a string provides a
 * human-readable error message; returning `false` shows a generic error.
 *
 * Re-exported from `@stellar-cross-border/sdk` for consumers who import
 * directly from this component file.
 */
export type { AddressValidator };

export interface PaymentFormProps {
  /** SDK instance — used only for submitting payments, NOT for validation. */
  sdk: StellarCrossBorderSDK;

  /**
   * Custom address validator.
   *
   * If omitted the form falls back to a basic Stellar public-key regex so
   * the component can still be rendered without an SDK or custom logic.
   */
  validateAddress?: AddressValidator;

  /**
   * Custom token list.  Overrides the built-in DEFAULT_TOKENS when provided.
   */
  tokens?: TokenEntry[];

  /**
   * Optional source for dynamically fetching token metadata (symbol, name,
   * contract address, price).  Only used when `tokens` is NOT explicitly
   * provided so that a fully custom list is never mutated.
   */
  tokenMetadataSource?: TokenMetadataSource;

  onSuccess?: (result: any) => void;
  onError?: (error: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PaymentForm: React.FC<PaymentFormProps> = ({
  sdk,
  validateAddress,
  tokens: tokensProp,
  tokenMetadataSource,
  onSuccess,
  onError,
}) => {
  // ── State ──────────────────────────────────────────────────────────────────
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [paymentResult, setPaymentResult] = useState<any>(null);

  // Token list state — starts from prop or default, may be enriched async.
  const [tokenList, setTokenList] = useState<TokenEntry[]>(
    tokensProp ?? DEFAULT_TOKENS
  );
  const [tokensLoading, setTokensLoading] = useState(false);

  // ── Form ───────────────────────────────────────────────────────────────────
  const {
    register,
    handleSubmit,
    formState: { errors, isValid },
  } = useForm<PaymentFormData>({
    mode: 'onChange',
    defaultValues: {
      feeBump:           true,
      releaseTime:       '24',
      customAssetCode:   '',
      customAssetIssuer: '',
    },
  });

  // ── Validator resolution ───────────────────────────────────────────────────
  /**
   * Resolves address validation result to a boolean or error string.
   * react-hook-form's `validate` option accepts exactly this shape.
   */
  const resolveValidator = useCallback(
    (address: string): boolean | string => {
      const validator = validateAddress ?? defaultStellarAddressValidator;
      const result = validator(address);
      if (result === true) return true;
      if (result === false) return 'Invalid Stellar address.';
      return result; // string error message
    },
    [validateAddress]
  );

  // ── Token list enrichment ──────────────────────────────────────────────────
  useEffect(() => {
    // If the caller supplied an explicit list, use it directly — no fetching.
    if (tokensProp) {
      setTokenList(tokensProp);
      return;
    }

    if (!tokenMetadataSource) return;

    let cancelled = false;
    setTokensLoading(true);

    fetchTokenList(DEFAULT_TOKENS, tokenMetadataSource)
      .then((enriched) => {
        if (!cancelled) setTokenList(enriched);
      })
      .finally(() => {
        if (!cancelled) setTokensLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tokensProp, tokenMetadataSource]);

  // ── Submission ─────────────────────────────────────────────────────────────
  const onSubmit = useCallback(
    async (data: PaymentFormData) => {
      setIsSubmitting(true);
      setCurrentStep(2);

      try {
        const releaseTime =
          Math.floor(Date.now() / 1000) + parseInt(data.releaseTime) * 3600;

        const paymentRequest: PaymentRequest = {
          from: data.from,
          to: data.to,
          amount: data.amount,
          token: data.token,
          release_time: releaseTime,
          metadata: {},
        };

        const paymentOptions: PaymentOptions = {
          feeBump: data.feeBump,
          memo: data.memo,
          submit: true,
        };

        const result = await sdk.paymentsInstance.createPayment(
          paymentRequest,
          paymentOptions
        );

        if (result.success) {
          setPaymentResult(result);
          setCurrentStep(3);
          onSuccess?.(result);
          toast.success('Payment created successfully!');
        } else {
          throw new Error(result.error || 'Payment creation failed');
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        onError?.(errorMessage);
        toast.error(errorMessage);
        setCurrentStep(1);
      } finally {
        setIsSubmitting(false);
      }
    },
    [sdk, onSuccess, onError]
  );

  const resetForm = () => {
    setCurrentStep(1);
    setPaymentResult(null);
    setIsSubmitting(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          Cross-Border Payment
        </h2>
        <p className="text-gray-600">
          Create a secure escrow payment with built-in compliance checks
        </p>
      </div>

      {/* Step indicator */}
      <div className="mb-6">
        <div className="flex items-center justify-between">
          {[1, 2, 3].map((step) => (
            <div key={step} className="flex items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                  currentStep >= step
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 text-gray-600'
                }`}
              >
                {step}
              </div>
              {step < 3 && (
                <div
                  className={`w-16 h-1 mx-2 ${
                    currentStep > step ? 'bg-blue-600' : 'bg-gray-200'
                  }`}
                />
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-between mt-2 text-xs text-gray-600">
          <span>Details</span>
          <span>Processing</span>
          <span>Complete</span>
        </div>
      </div>

      {/* ── Step 1: form ── */}
      {currentStep === 1 && (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* Addresses */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                From Address
              </label>
              <input
                {...register('from', {
                  required: 'Sender address is required',
                  validate: resolveValidator,
                })}
                type="text"
                placeholder="G…"
                data-testid="from-address"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isSubmitting}
              />
              {errors.from && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.from.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                To Address
              </label>
              <input
                {...register('to', {
                  required: 'Receiver address is required',
                  validate: resolveValidator,
                })}
                type="text"
                placeholder="G…"
                data-testid="to-address"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isSubmitting}
              />
              {errors.to && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.to.message}
                </p>
              )}
            </div>
          </div>

          {/* Amount + Token */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  {...register('amount', {
                    required: 'Amount is required',
                    pattern: {
                      value: /^\d+(\.\d{1,7})?$/,
                      message: 'Invalid amount format',
                    },
                  })}
                  type="text"
                  placeholder="0.00"
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isSubmitting}
                />
              </div>
              {errors.amount && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.amount.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Token
                {tokensLoading && (
                  <Loader2 className="inline-block ml-1 w-3 h-3 animate-spin text-blue-500" />
                )}
              </label>
              <select
                {...register('token', { required: 'Token is required' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isSubmitting || tokensLoading}
              >
                <option value="">
                  {tokensLoading ? 'Loading tokens…' : 'Select token'}
                </option>
                {tokenList.map((token) => (
                  <option key={token.symbol} value={token.contract}>
                    {token.symbol} – {token.name}
                    {token.priceUsd != null
                      ? ` ($${token.priceUsd.toFixed(4)})`
                      : ''}
                  </option>
                ))}
                {/* Custom asset entry */}
                <option value={CUSTOM_ASSET_VALUE}>⚙ Custom Asset…</option>
              </select>
              {errors.token && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.token.message}
                </p>
              )}
            </div>
          </div>

          {/* Release time + Memo */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Release Time (hours)
              </label>
              <div className="relative">
                <Clock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                  {...register('releaseTime', {
                    required: 'Release time is required',
                    min: { value: 1, message: 'Minimum 1 hour' },
                    max: { value: 168, message: 'Maximum 168 hours (7 days)' },
                  })}
                  type="number"
                  placeholder="24"
                  className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isSubmitting}
                />
              </div>
              {errors.releaseTime && (
                <p className="mt-1 text-sm text-red-600">
                  {errors.releaseTime.message}
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Memo (optional)
              </label>
              <input
                {...register('memo')}
                type="text"
                placeholder="Payment description"
                maxLength={28}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Fee bump */}
          <div className="flex items-center space-x-2">
            <input
              {...register('feeBump')}
              type="checkbox"
              id="feeBump"
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              disabled={isSubmitting}
            />
            <label htmlFor="feeBump" className="text-sm text-gray-700">
              Use fee bump transaction (recommended for cross-border)
            </label>
          </div>

          {/* Security callout */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
            <div className="flex items-start space-x-2">
              <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-1">Security Features</p>
                <ul className="list-disc list-inside space-y-1 text-blue-700">
                  <li>Time-locked escrow protects both parties</li>
                  <li>Automatic compliance checks</li>
                  <li>Dispute resolution mechanism</li>
                  <li>Fee bump ensures transaction completion</li>
                </ul>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={!isValid || isSubmitting}
            className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors duration-200 flex items-center justify-center space-x-2"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Processing…</span>
              </>
            ) : (
              <>
                <ArrowRight className="w-4 h-4" />
                <span>Create Payment</span>
              </>
            )}
          </button>
        </form>
      )}

      {/* ── Step 2: processing ── */}
      {currentStep === 2 && (
        <div className="text-center py-8">
          <Loader2 className="w-12 h-12 animate-spin text-blue-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Processing Payment
          </h3>
          <p className="text-gray-600">
            Creating escrow and running compliance checks…
          </p>
        </div>
      )}

      {/* ── Step 3: success ── */}
      {currentStep === 3 && paymentResult && (
        <div className="text-center py-8">
          <CheckCircle className="w-12 h-12 text-green-600 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Payment Created Successfully!
          </h3>
          <div className="bg-gray-50 rounded-md p-4 mb-6 text-left">
            <div className="space-y-2">
              <div>
                <span className="text-sm font-medium text-gray-700">
                  Transaction Hash:
                </span>
                <p className="text-sm text-gray-600 font-mono break-all">
                  {paymentResult.hash}
                </p>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-700">
                  Escrow ID:
                </span>
                <p className="text-sm text-gray-600 font-mono break-all">
                  {paymentResult.escrowId}
                </p>
              </div>
            </div>
          </div>
          <button
            onClick={resetForm}
            className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 transition-colors duration-200"
          >
            Create Another Payment
          </button>
        </div>
      )}
    </div>
  );
};
