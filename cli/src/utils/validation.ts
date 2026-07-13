import axios from 'axios';
import { isValidStellarPublicKey } from '@stellar-cross-border/sdk';
import { PaymentRecord, ValidationResult } from '../types';
import * as logger from './logger';

export interface RequiredOption {
  key: string;
  envKey: string;
  description: string;
  optName: string;
}

export function validateRequiredOptions(
  opts: any,
  env: NodeJS.ProcessEnv,
  requiredOptions: RequiredOption[]
): void {
  for (const req of requiredOptions) {
    const value = opts[req.key];
    if (!value) {
      const envValue = env[req.envKey];
      if (envValue) {
        opts[req.key] = envValue;
        logger.warn(`Using ${req.envKey} from environment variables instead of explicit ${req.optName}`);
      } else {
        throw new Error(`Missing required configuration. Please provide the following via command line options or environment variables:\n- ${req.optName} (or ${req.envKey})`);
      }
    }
  }
}

export function validateStellarAddress(address: string): boolean {
  return isValidStellarPublicKey(address);
}

export async function validateDestination(
  address: string,
  asset: string,
  horizonUrl: string
): Promise<ValidationResult> {
  const result: ValidationResult = {
    valid: false,
    accountExists: false,
    hasTrustline: false,
    errors: [],
  };

  if (!validateStellarAddress(address)) {
    result.errors.push(`Invalid Stellar address: ${address}`);
    return result;
  }

  try {
    const response = await axios.get(`${horizonUrl}/accounts/${address}`, {
      timeout: 10000,
    });
    result.accountExists = true;

    if (asset === 'XLM' || asset === 'native') {
      result.hasTrustline = true;
    } else {
      const balances = response.data.balances || [];
      const hasTrust = balances.some(
        (b: Record<string, string>) =>
          b.asset_code === asset || b.asset_type === 'native'
      );
      result.hasTrustline = hasTrust;
      if (!hasTrust) {
        result.errors.push(
          `Account ${address} does not have a trustline for ${asset}`
        );
      }
    }
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number } };
    if (axiosErr.response?.status === 404) {
      result.errors.push(`Account does not exist: ${address}`);
    } else {
      result.errors.push(`Failed to validate account ${address}: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
    return result;
  }

  result.valid = result.accountExists && result.hasTrustline && result.errors.length === 0;
  return result;
}

export async function validateBatch(
  records: PaymentRecord[],
  horizonUrl: string,
  skipAddressCheck: boolean = false
): Promise<{ valid: PaymentRecord[]; invalid: Array<{ record: PaymentRecord; errors: string[] }> }> {
  const valid: PaymentRecord[] = [];
  const invalid: Array<{ record: PaymentRecord; errors: string[] }> = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const errors: string[] = [];

    if (!record.destination) {
      errors.push('Missing destination address');
    } else if (!validateStellarAddress(record.destination)) {
      errors.push(`Invalid Stellar address: ${record.destination}`);
    }

    if (!record.amount || isNaN(Number(record.amount)) || Number(record.amount) <= 0) {
      errors.push(`Invalid amount: ${record.amount}`);
    }

    if (!record.asset) {
      errors.push('Missing asset code');
    }

    if (record.escrow_duration !== undefined && record.escrow_duration < 0) {
      errors.push(`Invalid escrow duration: ${record.escrow_duration}`);
    }

    if (!skipAddressCheck && errors.length === 0) {
      const validation = await validateDestination(record.destination, record.asset, horizonUrl);
      if (!validation.valid) {
        errors.push(...validation.errors);
      }
    }

    if (errors.length > 0) {
      invalid.push({ record, errors });
      logger.warn(`Payment #${i + 1} invalid: ${errors.join(', ')}`);
    } else {
      valid.push(record);
    }
  }

  return { valid, invalid };
}

export async function checkFeeSurge(horizonUrl: string, threshold: number): Promise<{ surging: boolean; currentFee: number }> {
  try {
    const response = await axios.get(`${horizonUrl}/fee_stats`, { timeout: 10000 });
    const lastFee = parseInt(response.data.last_ledger_base_fee || '100', 10);
    return {
      surging: lastFee > threshold,
      currentFee: lastFee,
    };
  } catch {
    return { surging: false, currentFee: 100 };
  }
}
