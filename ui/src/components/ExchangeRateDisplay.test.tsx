/**
 * Tests for ExchangeRateDisplay — loading placeholders, error states, retry
 * (requirements b & c).
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ExchangeRateDisplay } from './ExchangeRateDisplay';
import { ExchangeRateResult } from '@stellar-cross-border/sdk';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockRate: ExchangeRateResult = {
  rate: '1.2345',
  timestamp: Math.floor(Date.now() / 1000),
  sources: [],
  aggregated: {
    rate: '1.2345',
    weighted_average: '1.2344',
    sources_count: 3,
    last_updated: Math.floor(Date.now() / 1000),
    deviation_threshold: 85,
  },
};

// Build a minimal SDK stub with a configurable getExchangeRate mock
function createSdkStub(
  getExchangeRate: jest.Mock = jest.fn().mockResolvedValue(mockRate)
) {
  return {
    paymentsInstance: { getExchangeRate },
  } as any;
}

// ---------------------------------------------------------------------------
// Loading state
// ---------------------------------------------------------------------------

describe('ExchangeRateDisplay — loading state', () => {
  it('renders skeleton placeholders while the initial fetch is in-flight', async () => {
    // getExchangeRate never resolves → component stays in loading state
    const sdk = createSdkStub(
      jest.fn(() => new Promise<ExchangeRateResult>(() => {}))
    );

    render(
      <ExchangeRateDisplay
        sdk={sdk}
        fromCurrency="XLM"
        toCurrency="USDC"
        autoRefresh={false}
      />
    );

    // Skeleton elements are rendered as aria-hidden divs with the animate-pulse class
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);

    // Rate value and error should not be present
    expect(screen.queryByText(/unable to load/i)).not.toBeInTheDocument();
  });

  it('removes skeleton placeholders once data arrives', async () => {
    const sdk = createSdkStub();

    render(
      <ExchangeRateDisplay
        sdk={sdk}
        fromCurrency="XLM"
        toCurrency="USDC"
        autoRefresh={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText('1.2345')).toBeInTheDocument();
    });

    // After data loads the skeleton elements should be gone
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBe(0);
  });

  it('shows a spinning refresh icon while a manual refresh is in-flight', async () => {
    let resolveFirst!: (v: ExchangeRateResult) => void;
    let callCount = 0;

    const getExchangeRate = jest.fn(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve(mockRate);
      // Second call (manual refresh) never resolves
      return new Promise<ExchangeRateResult>((res) => {
        resolveFirst = res;
      });
    });

    const sdk = createSdkStub(getExchangeRate);

    render(
      <ExchangeRateDisplay
        sdk={sdk}
        fromCurrency="XLM"
        toCurrency="USDC"
        autoRefresh={false}
      />
    );

    // Wait for initial data
    await waitFor(() => screen.getByText('1.2345'));

    // Click Refresh
    const refreshBtn = screen.getByRole('button', { name: /refresh exchange rate/i });
    await userEvent.click(refreshBtn);

    // During second fetch the button label changes
    expect(screen.getByText(/refreshing/i)).toBeInTheDocument();

    // Clean up — resolve the hanging promise
    act(() => resolveFirst(mockRate));
  });
});

// ---------------------------------------------------------------------------
// Error state
// ---------------------------------------------------------------------------

describe('ExchangeRateDisplay — error state', () => {
  it('renders an error card (not a skeleton) when the initial fetch fails', async () => {
    const sdk = createSdkStub(
      jest.fn().mockRejectedValue(new Error('Horizon unavailable'))
    );

    render(
      <ExchangeRateDisplay
        sdk={sdk}
        fromCurrency="XLM"
        toCurrency="USDC"
        autoRefresh={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/unable to load exchange rate/i)).toBeInTheDocument();
    });

    // Error message includes the thrown message
    expect(screen.getByText(/horizon unavailable/i)).toBeInTheDocument();

    // Skeleton must not be present
    expect(document.querySelectorAll('.animate-pulse').length).toBe(0);
  });

  it('shows a Retry button in the error card', async () => {
    const sdk = createSdkStub(
      jest.fn().mockRejectedValue(new Error('Timeout'))
    );

    render(
      <ExchangeRateDisplay
        sdk={sdk}
        fromCurrency="XLM"
        toCurrency="USDC"
        autoRefresh={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });

  it('clears the error and shows data after a successful retry', async () => {
    const getExchangeRate = jest
      .fn()
      .mockRejectedValueOnce(new Error('First attempt fails'))
      .mockResolvedValueOnce(mockRate);

    const sdk = createSdkStub(getExchangeRate);

    render(
      <ExchangeRateDisplay
        sdk={sdk}
        fromCurrency="XLM"
        toCurrency="USDC"
        autoRefresh={false}
      />
    );

    // Wait for error state
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });

    // Click Retry
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));

    // Error should clear and rate should appear
    await waitFor(() => {
      expect(screen.queryByText(/unable to load exchange rate/i)).not.toBeInTheDocument();
      expect(screen.getByText('1.2345')).toBeInTheDocument();
    });
  });

  it('shows an inline error banner (not full error card) when stale data is present', async () => {
    const getExchangeRate = jest
      .fn()
      .mockResolvedValueOnce(mockRate)
      .mockRejectedValueOnce(new Error('Refresh failed'));

    const sdk = createSdkStub(getExchangeRate);

    render(
      <ExchangeRateDisplay
        sdk={sdk}
        fromCurrency="XLM"
        toCurrency="USDC"
        autoRefresh={false}
      />
    );

    // Wait for initial data
    await waitFor(() => screen.getByText('1.2345'));

    // Trigger a manual refresh that will fail
    const refreshBtn = screen.getByRole('button', { name: /refresh exchange rate/i });
    await userEvent.click(refreshBtn);

    await waitFor(() => {
      // Inline banner should appear but old rate is still visible
      expect(screen.getByText(/rate update failed/i)).toBeInTheDocument();
      expect(screen.getByText('1.2345')).toBeInTheDocument();
    });

    // Full error card must NOT replace the content
    expect(screen.queryByText(/unable to load exchange rate/i)).not.toBeInTheDocument();
  });

  it('the inline error banner contains a "Try again" action', async () => {
    const getExchangeRate = jest
      .fn()
      .mockResolvedValueOnce(mockRate)
      .mockRejectedValueOnce(new Error('Refresh failed'));

    const sdk = createSdkStub(getExchangeRate);

    render(
      <ExchangeRateDisplay
        sdk={sdk}
        fromCurrency="XLM"
        toCurrency="USDC"
        autoRefresh={false}
      />
    );

    await waitFor(() => screen.getByText('1.2345'));

    await userEvent.click(screen.getByRole('button', { name: /refresh exchange rate/i }));

    await waitFor(() => {
      expect(screen.getByText(/try again/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Auto-refresh
// ---------------------------------------------------------------------------

describe('ExchangeRateDisplay — auto-refresh', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('re-fetches at the configured interval', async () => {
    const getExchangeRate = jest.fn().mockResolvedValue(mockRate);
    const sdk = createSdkStub(getExchangeRate);

    render(
      <ExchangeRateDisplay
        sdk={sdk}
        fromCurrency="XLM"
        toCurrency="USDC"
        autoRefresh={5000}
      />
    );

    // Initial fetch
    await waitFor(() => expect(getExchangeRate).toHaveBeenCalledTimes(1));

    // Advance timer
    act(() => jest.advanceTimersByTime(5000));

    await waitFor(() => expect(getExchangeRate).toHaveBeenCalledTimes(2));
  });

  it('does NOT auto-refresh when autoRefresh is false', async () => {
    const getExchangeRate = jest.fn().mockResolvedValue(mockRate);
    const sdk = createSdkStub(getExchangeRate);

    render(
      <ExchangeRateDisplay
        sdk={sdk}
        fromCurrency="XLM"
        toCurrency="USDC"
        autoRefresh={false}
      />
    );

    await waitFor(() => expect(getExchangeRate).toHaveBeenCalledTimes(1));

    act(() => jest.advanceTimersByTime(120_000));

    // Still only the initial call
    expect(getExchangeRate).toHaveBeenCalledTimes(1);
  });
});
