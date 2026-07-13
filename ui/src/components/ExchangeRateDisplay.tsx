import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  DollarSign,
  Activity,
  Clock,
  Info,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { StellarCrossBorderSDK } from '@stellar-cross-border/sdk';
import { ExchangeRateResult, ExchangeRateRequest } from '@stellar-cross-border/sdk';
import { format } from 'date-fns';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ExchangeRateDisplayProps {
  sdk: StellarCrossBorderSDK;
  fromCurrency: string;
  toCurrency: string;
  amount?: string;
  showHistorical?: boolean;
  /**
   * Auto-refresh interval in milliseconds.
   * Set to 0 or false to disable auto-refresh.
   * Defaults to 60 000 ms (1 minute).
   */
  autoRefresh?: boolean | number;
}

// ---------------------------------------------------------------------------
// Skeleton placeholder
// ---------------------------------------------------------------------------

const Skeleton: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div
    className={`animate-pulse bg-gray-200 rounded ${className}`}
    aria-hidden="true"
  />
);

const RateSkeleton: React.FC = () => (
  <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
    {/* Header */}
    <div className="flex items-center justify-between mb-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-8 w-20" />
    </div>

    {/* Hero card */}
    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6 mb-6">
      <div className="flex flex-col items-center space-y-3">
        <div className="flex items-center space-x-4">
          <Skeleton className="h-10 w-16" />
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-10 w-16" />
        </div>
        <Skeleton className="h-12 w-32" />
        <Skeleton className="h-4 w-48" />
      </div>
    </div>

    {/* Stat cards */}
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
      {[0, 1].map((i) => (
        <div key={i} className="border border-gray-200 rounded-lg p-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>

    {/* Detail rows */}
    {[0, 1, 2].map((i) => (
      <div key={i} className="flex justify-between py-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-20" />
      </div>
    ))}
  </div>
);

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

interface ErrorCardProps {
  message: string;
  onRetry: () => void;
  retrying: boolean;
}

const ErrorCard: React.FC<ErrorCardProps> = ({ message, onRetry, retrying }) => (
  <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
    <div className="flex items-start space-x-3 text-red-700 mb-4">
      <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
      <div>
        <p className="font-medium">Unable to load exchange rate</p>
        <p className="text-sm text-red-600 mt-1">{message}</p>
      </div>
    </div>
    <button
      onClick={onRetry}
      disabled={retrying}
      className="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors duration-200"
      aria-label="Retry fetching exchange rate"
    >
      <RefreshCw className={`w-4 h-4 ${retrying ? 'animate-spin' : ''}`} />
      <span>{retrying ? 'Retrying…' : 'Retry'}</span>
    </button>
  </div>
);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export const ExchangeRateDisplay: React.FC<ExchangeRateDisplayProps> = ({
  sdk,
  fromCurrency,
  toCurrency,
  amount = '1',
  showHistorical = false,
  autoRefresh = true,
}) => {
  const [rateData, setRateData] = useState<ExchangeRateResult | null>(null);
  // `loading` is true only on the initial (no-data) fetch.
  const [loading, setLoading] = useState(true);
  // `refreshing` is true during subsequent background refreshes.
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Keep a ref to whether we have data so the fetch callback can read it
  // without needing rateData in its dependency array (avoids stale closure).
  const hasDataRef = useRef(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────

  const fetchExchangeRate = useCallback(
    async (isManual = false) => {
      // On manual retry/refresh, show the refreshing spinner but keep
      // existing data visible so the layout doesn't collapse.
      if (isManual || hasDataRef.current) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      try {
        const request: ExchangeRateRequest = {
          from_currency: fromCurrency,
          to_currency: toCurrency,
        };

        const result = await sdk.paymentsInstance.getExchangeRate(request);
        setRateData(result);
        setLastUpdated(new Date());
        hasDataRef.current = true;
        // Clear any previous error once data arrives successfully.
        setError(null);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Failed to fetch exchange rate';
        setError(msg);
        // Keep stale data in place so the layout remains stable; the error
        // banner will appear above the (possibly stale) content.
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fromCurrency, toCurrency, sdk]
  );

  // Initial fetch + currency-change re-fetch
  useEffect(() => {
    setLoading(true);
    setError(null);
    setRateData(null);
    hasDataRef.current = false;
    fetchExchangeRate();
  }, [fromCurrency, toCurrency, fetchExchangeRate]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const intervalMs =
      typeof autoRefresh === 'number' ? autoRefresh : 60_000;

    const id = setInterval(() => fetchExchangeRate(), intervalMs);
    return () => clearInterval(id);
  }, [autoRefresh, fetchExchangeRate]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleRefresh = () => fetchExchangeRate(true);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const calculateConvertedAmount = (): string => {
    if (!rateData || !amount) return '0';
    const rate = parseFloat(rateData.rate);
    const amountNum = parseFloat(amount);
    if (isNaN(rate) || isNaN(amountNum)) return '0';
    return (amountNum * rate).toFixed(7);
  };

  const formatRate = (rate: string): string => {
    const num = parseFloat(rate);
    if (isNaN(num)) return '—';
    return num.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 7,
    });
  };

  const getTrendIcon = () => {
    if (!rateData || !showHistorical) return null;
    // Placeholder: real implementation would diff against a cached previous rate.
    const isUp = Math.random() > 0.5;
    return isUp ? (
      <TrendingUp className="w-4 h-4 text-green-500" aria-label="Rate trending up" />
    ) : (
      <TrendingDown className="w-4 h-4 text-red-500" aria-label="Rate trending down" />
    );
  };

  const getConfidenceColor = (threshold: number) => {
    if (threshold >= 80) return 'text-green-600';
    if (threshold >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getConfidenceLabel = (threshold: number) => {
    if (threshold >= 80) return 'High';
    if (threshold >= 60) return 'Medium';
    return 'Low';
  };

  // ── Render branches ────────────────────────────────────────────────────────

  // Show skeleton only on the very first load (no data yet, no error).
  if (loading && !rateData && !error) {
    return <RateSkeleton />;
  }

  // Show error card when there is no data to fall back on.
  if (error && !rateData) {
    return (
      <ErrorCard
        message={error}
        onRetry={handleRefresh}
        retrying={refreshing}
      />
    );
  }

  // At this point we have rateData (possibly stale).
  return (
    <div className="max-w-2xl mx-auto bg-white rounded-lg shadow-lg p-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-900">Exchange Rate</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center space-x-1 text-gray-600 hover:text-gray-800 disabled:opacity-50 transition-colors"
          aria-label="Refresh exchange rate"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="text-sm">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
        </button>
      </div>

      {/* ── Inline error banner (shows over stale data) ── */}
      {error && rateData && (
        <div
          className="flex items-start space-x-2 bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-sm text-red-700"
          role="alert"
        >
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <span className="font-medium">Rate update failed:</span>{' '}
            {error}{' '}
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="underline font-medium disabled:opacity-50"
            >
              {refreshing ? 'Retrying…' : 'Try again'}
            </button>
          </div>
        </div>
      )}

      {/* ── Hero rate card ── */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-6 mb-6">
        <div className="text-center">
          <div className="flex items-center justify-center space-x-4 mb-4">
            <div className="text-3xl font-bold text-gray-900">{fromCurrency}</div>
            <div className="text-gray-400">→</div>
            <div className="text-3xl font-bold text-gray-900">{toCurrency}</div>
            {showHistorical && getTrendIcon()}
          </div>

          {rateData ? (
            <>
              <div className="text-4xl font-bold text-blue-600 mb-2">
                {formatRate(rateData.rate)}
              </div>
              <div className="text-sm text-gray-600">
                1 {fromCurrency} = {formatRate(rateData.rate)} {toCurrency}
              </div>
            </>
          ) : (
            <>
              <Skeleton className="h-10 w-32 mx-auto mb-2" />
              <Skeleton className="h-4 w-48 mx-auto" />
            </>
          )}
        </div>
      </div>

      {/* ── Converted amount ── */}
      {amount !== '1' && rateData && (
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">Amount to Convert</div>
              <div className="text-xl font-semibold text-gray-900">
                {amount} {fromCurrency}
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm text-gray-600">Converted Amount</div>
              <div className="text-xl font-semibold text-green-600">
                {calculateConvertedAmount()} {toCurrency}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <Activity className="w-4 h-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">Rate Sources</span>
          </div>
          {rateData ? (
            <>
              <div className="text-2xl font-bold text-gray-900">
                {rateData.aggregated.sources_count}
              </div>
              <div className="text-sm text-gray-600">
                Active sources contributing to this rate
              </div>
            </>
          ) : (
            <>
              <Skeleton className="h-8 w-8 mb-1" />
              <Skeleton className="h-3 w-40" />
            </>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="flex items-center space-x-2 mb-2">
            <DollarSign className="w-4 h-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">Confidence</span>
          </div>
          {rateData ? (
            <>
              <div
                className={`text-2xl font-bold ${getConfidenceColor(
                  rateData.aggregated.deviation_threshold
                )}`}
              >
                {getConfidenceLabel(rateData.aggregated.deviation_threshold)}
              </div>
              <div className="text-sm text-gray-600">
                Based on {rateData.aggregated.deviation_threshold}% deviation threshold
              </div>
            </>
          ) : (
            <>
              <Skeleton className="h-8 w-16 mb-1" />
              <Skeleton className="h-3 w-40" />
            </>
          )}
        </div>
      </div>

      {/* ── Detail rows ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-2 text-gray-600">
            <Clock className="w-4 h-4" />
            <span>Last Updated</span>
          </div>
          <span className="text-gray-900">
            {lastUpdated
              ? format(lastUpdated, 'MMM dd, yyyy HH:mm:ss')
              : '—'}
          </span>
        </div>

        {rateData && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Weighted Average</span>
              <span className="text-gray-900">
                {formatRate(rateData.aggregated.weighted_average)}
              </span>
            </div>

            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Deviation Threshold</span>
              <span className="text-gray-900">
                {rateData.aggregated.deviation_threshold}%
              </span>
            </div>
          </>
        )}
      </div>

      {/* ── Rate sources list ── */}
      {rateData && rateData.sources.length > 0 && (
        <div className="mt-6 pt-6 border-t">
          <h3 className="text-lg font-medium text-gray-900 mb-4">Rate Sources</h3>
          <div className="space-y-2">
            {rateData.sources.map((source, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div>
                  <div className="font-medium text-gray-900">{source.source}</div>
                  <div className="text-sm text-gray-600">
                    Confidence: {source.confidence}%
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-medium text-gray-900">
                    {formatRate(source.rate)}
                  </div>
                  <div className="text-sm text-gray-600">
                    {format(new Date(source.timestamp * 1000), 'HH:mm:ss')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Info callout ── */}
      <div className="mt-6 pt-6 border-t">
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <div className="flex items-start space-x-2">
            <Info className="w-5 h-5 text-blue-600 mt-0.5" />
            <div className="text-sm text-blue-800">
              <p className="font-medium mb-1">About Exchange Rates</p>
              <p className="text-blue-700">
                Exchange rates are aggregated from multiple on-chain sources and
                updated in real-time. Rates are calculated using a weighted average
                with confidence scores and deviation filtering to ensure accuracy.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
