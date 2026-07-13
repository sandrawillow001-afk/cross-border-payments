/**
 * Tests for PaymentForm — focusing on:
 *   (a) configurable token list via props
 *   (d) address validation provided through the validateAddress prop
 *       instead of sdk.clientInstance.validateAddress
 */
import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PaymentForm, AddressValidator } from './PaymentForm';
import { TokenEntry } from '../lib/tokens';

// ---------------------------------------------------------------------------
// Minimal SDK stub — the component must NOT call clientInstance.validateAddress
// ---------------------------------------------------------------------------

const createSdkStub = () => ({
  clientInstance: {
    validateAddress: jest.fn(() => {
      throw new Error(
        'PaymentForm must NOT call sdk.clientInstance.validateAddress directly.'
      );
    }),
  },
  paymentsInstance: {
    createPayment: jest.fn().mockResolvedValue({
      success: true,
      hash: 'abc123',
      escrowId: 'escrow-001',
    }),
  },
});

// Valid 56-char Stellar G-address
const VALID_ADDRESS = 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFLBKYXRH7CL5BJM4A3';
const INVALID_ADDRESS = 'not-a-valid-address';

const alwaysValidValidator: AddressValidator = () => true;

function renderForm(props: Partial<Parameters<typeof PaymentForm>[0]> = {}) {
  const sdk = createSdkStub() as any;
  return {
    sdk,
    ...render(
      <PaymentForm
        sdk={sdk}
        validateAddress={alwaysValidValidator}
        {...props}
      />
    ),
  };
}

// Helpers — query by data-testid to avoid ambiguity with identical placeholders
const getFromInput = () => screen.getByTestId('from-address');
const getToInput   = () => screen.getByTestId('to-address');

// ---------------------------------------------------------------------------
// A. Token list via props
// ---------------------------------------------------------------------------

describe('PaymentForm — token list', () => {
  it('renders the default token options when no tokens prop is supplied', () => {
    renderForm();
    expect(screen.getByRole('option', { name: /XLM/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /USDC/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /EURC/i })).toBeInTheDocument();
  });

  it('renders ONLY the custom tokens when a tokens prop is supplied', () => {
    const customTokens: TokenEntry[] = [
      { symbol: 'FOO', name: 'Foo Token', contract: 'CFOO00' },
      { symbol: 'BAR', name: 'Bar Token', contract: 'CBAR00' },
    ];

    renderForm({ tokens: customTokens });

    expect(screen.getByRole('option', { name: /FOO/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /BAR/i })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^XLM/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^USDC/i })).not.toBeInTheDocument();
  });

  it('shows the USD price when a token carries priceUsd metadata', () => {
    const tokens: TokenEntry[] = [
      { symbol: 'USDC', name: 'USD Coin', contract: 'CUSDC', priceUsd: 1.0005 },
    ];

    renderForm({ tokens });

    const option = screen.getByRole('option', { name: /USDC/ });
    expect(option.textContent).toMatch(/1\.0005/);
  });

  it('shows a loading indicator while tokens are being fetched', () => {
    const source = {
      fetchMetadata: () => new Promise<Record<string, Partial<TokenEntry>>>(() => {}),
    };

    renderForm({ tokens: undefined, tokenMetadataSource: source });

    // While loading the select is disabled
    const select = screen.getByRole('combobox');
    expect(select).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// D. Address validation via prop — no sdk.clientInstance coupling
// ---------------------------------------------------------------------------

describe('PaymentForm — validateAddress prop', () => {
  it('does NOT call sdk.clientInstance.validateAddress', async () => {
    const sdk = createSdkStub() as any;
    const customValidator: AddressValidator = jest.fn(() => true);

    render(
      <PaymentForm
        sdk={sdk}
        validateAddress={customValidator}
        tokens={[{ symbol: 'XLM', name: 'Stellar Lumens', contract: 'native' }]}
      />
    );

    await userEvent.type(getFromInput(), VALID_ADDRESS);

    expect(sdk.clientInstance.validateAddress).not.toHaveBeenCalled();
  });

  it('calls the supplied validateAddress prop with the entered address', async () => {
    const customValidator: AddressValidator = jest.fn(() => true);

    renderForm({ validateAddress: customValidator });

    await userEvent.type(getFromInput(), VALID_ADDRESS);
    await userEvent.tab();

    expect(customValidator).toHaveBeenCalledWith(
      expect.stringContaining(VALID_ADDRESS.slice(0, 5))
    );
  });

  it('shows the error string returned by the validator', async () => {
    const customValidator: AddressValidator = jest.fn(
      () => 'Custom validation error message'
    );

    renderForm({ validateAddress: customValidator });

    await userEvent.type(getFromInput(), INVALID_ADDRESS);
    await userEvent.tab();

    await waitFor(() => {
      expect(screen.getByText('Custom validation error message')).toBeInTheDocument();
    });
  });

  it('shows a generic error when the validator returns false', async () => {
    const customValidator: AddressValidator = jest.fn(() => false);

    renderForm({ validateAddress: customValidator });

    await userEvent.type(getFromInput(), INVALID_ADDRESS);
    await userEvent.tab();

    await waitFor(() => {
      expect(screen.getByText(/invalid stellar address/i)).toBeInTheDocument();
    });
  });

  it('uses a built-in fallback validator when validateAddress is omitted', async () => {
    const sdk = createSdkStub() as any;
    render(
      <PaymentForm
        sdk={sdk}
        tokens={[{ symbol: 'XLM', name: 'Stellar Lumens', contract: 'native' }]}
      />
    );

    await userEvent.type(getFromInput(), INVALID_ADDRESS);
    await userEvent.tab();

    await waitFor(() => {
      expect(screen.getByText(/valid stellar address/i)).toBeInTheDocument();
    });

    expect(sdk.clientInstance.validateAddress).not.toHaveBeenCalled();
  });

  it('accepts a valid Stellar address with the fallback validator', async () => {
    const sdk = createSdkStub() as any;
    render(
      <PaymentForm
        sdk={sdk}
        tokens={[{ symbol: 'XLM', name: 'Stellar Lumens', contract: 'native' }]}
      />
    );

    await userEvent.type(getFromInput(), VALID_ADDRESS);
    await userEvent.tab();

    await waitFor(() => {
      expect(screen.queryByText(/valid stellar address/i)).not.toBeInTheDocument();
    });
  });
});
