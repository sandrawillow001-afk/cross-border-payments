import {
  Account,
  Address,
  Contract,
  Keypair,
  Operation,
  ScInt,
  TransactionBuilder,
  nativeToScVal,
  scValToNative,
  xdr,
} from 'stellar-sdk';
import BigNumber from 'bignumber.js';
import { StellarClient } from './client';
import {
  AggregatedRate,
  ComplianceCheck,
  ComplianceCheckResult,
  ComplianceRequest,
  EscrowCreationResult,
  EscrowStatus,
  Escrow,
  ExchangeRateRequest,
  ExchangeRateResult,
  MetadataRecord,
  MetadataValue,
  PaymentOptions,
  PaymentRequest,
  PaymentStatus,
  TransactionResult,
} from './types';
import { TransactionEventEmitter } from './events';

// ─── Primitive converters ────────────────────────────────────────────────────

export function toScValString(value: string): xdr.ScVal {
  return xdr.ScVal.scvString(Buffer.from(value, 'utf8'));
}

export function toScValU64(value: number | bigint): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: 'u64' });
}

export function toScValI128(value: number | bigint): xdr.ScVal {
  return nativeToScVal(BigInt(value), { type: 'i128' });
}

export function toScValBool(value: boolean): xdr.ScVal {
  return xdr.ScVal.scvBool(value);
}

export function toScValAddress(address: string): xdr.ScVal {
  try {
    return new Address(address).toScVal();
  } catch {
    throw new Error(`Cannot convert to SCVal address: "${address}"`);
  }
}

// ─── Metadata map converter ──────────────────────────────────────────────────

/**
 * Converts a flat MetadataRecord to a Soroban SCVal map.
 * Keys are SCVal strings; values are typed based on their JS type.
 */
export function metadataToScVal(metadata: MetadataRecord): xdr.ScVal {
  const entries = Object.entries(metadata).map(([key, val]) => {
    const scKey = toScValString(key);
    const scVal = metadataValueToScVal(key, val);
    return new xdr.ScMapEntry({ key: scKey, val: scVal });
  });
  return xdr.ScVal.scvMap(entries);
}

function metadataValueToScVal(key: string, value: MetadataValue): xdr.ScVal {
  switch (typeof value) {
    case 'string':  return toScValString(value);
    case 'boolean': return toScValBool(value);
    case 'number': {
      if (!Number.isFinite(value)) {
        throw new Error(`Metadata key "${key}": value must be a finite number.`);
      }
      // Use i128 for amounts, u64 for timestamps/counts
      return Number.isInteger(value)
        ? toScValU64(value)
        : toScValI128(Math.round(value * 10_000_000)); // stroop precision
    }
    default:
      throw new Error(`Metadata key "${key}": unsupported type "${typeof value}".`);
  }
}

// ─── Round-trip helper ───────────────────────────────────────────────────────

/**
 * Converts an SCVal map back to a plain MetadataRecord.
 * Useful for reading contract state.
 */
export function scValToMetadata(scVal: xdr.ScVal): MetadataRecord {
  try {
    const native = scValToNative(scVal);
    if (typeof native !== 'object' || native === null) {
      throw new Error('SCVal is not a map.');
    }
    return native as MetadataRecord;
  } catch (err) {
    throw new Error(`Failed to convert SCVal to metadata: ${(err as Error).message}`);
  }
}

// ─── Optional field helper ───────────────────────────────────────────────────

/**
 * Wraps a value in SCVal Option (Some/None).
 * Use for optional contract parameters.
 */
export function toScValOption(value: xdr.ScVal | null): xdr.ScVal {
  return value === null
    ? xdr.ScVal.scvVoid()
    : xdr.ScVal.scvVec([xdr.ScVal.scvSymbol('Some'), value]);
}

// ─── StellarPayments class ───────────────────────────────────────────────────

export class StellarPayments {
  private client: StellarClient;
  private emitter?: TransactionEventEmitter;

  constructor(client: StellarClient, emitter?: TransactionEventEmitter) {
    this.client = client;
    this.emitter = emitter;
  }

  private async buildPaymentTransaction(
    sourceAccount: Account,
    operations: Operation[],
    options: PaymentOptions = {}
  ) {
    return this.client.buildTransaction(sourceAccount, operations, {
      feeBump: options.feeBump,
      memo: options.memo,
      timeout: options.timeout,
    });
  }

  async createPayment(
    request: PaymentRequest,
    options: PaymentOptions = {}
  ): Promise<EscrowCreationResult> {
    try {
      const sourceAccount = await this.getSourceAccount(request.from);

      const escrowContract = this.client.getEscrowContract();

      const releaseTime =
        request.release_time || Math.floor(Date.now() / 1000) + 24 * 60 * 60;

      const metadata = request.metadata || {};
      const metadataScVal = this.convertMetadataToScVal(metadata);

      const createEscrowOp = escrowContract.call(
        'create_escrow',
        new Address(request.from).toScVal(),
        new Address(request.to).toScVal(),
        new ScInt(request.amount).toI128(),
        new Address(request.token).toScVal(),
        new ScInt(releaseTime).toU64(),
        metadataScVal
      ) as unknown as Operation;

      const builder = await this.buildPaymentTransaction(
        sourceAccount,
        [createEscrowOp],
        options
      );

      const transaction = builder.build();

      if (options.submit !== false) {
        const txHash = transaction.hash().toString('hex');

        // Emit: submitted
        this.emitter?.emitSubmitted({ hash: txHash, timestamp: Date.now() });

        const result = await this.client.submitTransaction(transaction.toXDR());

        if (result.success && result.result) {
          const escrowId = this.extractEscrowIdFromResult(result.result);

          // Emit: confirmed + escrow:created
          this.emitter?.emitConfirmed({ hash: result.hash, result: result.result });
          if (escrowId) {
            this.emitter?.emitEscrowCreated({ escrowId, hash: result.hash, request });
          }

          return { ...result, escrowId };
        }

        // Emit: failed
        this.emitter?.emitFailed({
          hash: result.hash || txHash,
          error: result.error ?? 'Payment creation failed',
        });

        return {
          hash: result.hash,
          success: false,
          error: result.error,
          escrowId: '',
        };
      }

      return {
        hash: transaction.hash().toString('hex'),
        success: true,
        escrowId: '',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emitter?.emitFailed({ hash: '', error: message });
      return {
        hash: '',
        success: false,
        error: message,
        escrowId: '',
      };
    }
  }

  async releaseEscrow(
    escrowId: string,
    signer: Keypair,
    options: PaymentOptions = {}
  ): Promise<TransactionResult> {
    try {
      const sourceAccount = await this.getSourceAccount(signer.publicKey());

      const escrowContract = this.client.getEscrowContract();
      const releaseEscrowOp = escrowContract.call(
        'release_escrow',
        xdr.ScVal.scvBytes(Buffer.from(escrowId, 'hex'))
      ) as unknown as Operation;

      const builder = await this.buildPaymentTransaction(
        sourceAccount,
        [releaseEscrowOp],
        options
      );

      const transaction = builder.build();
      transaction.sign(signer);

      if (options.submit !== false) {
        const txHash = transaction.hash().toString('hex');
        this.emitter?.emitSubmitted({ hash: txHash, timestamp: Date.now() });

        const result = await this.client.submitTransaction(transaction.toXDR());

        if (result.success) {
          this.emitter?.emitConfirmed({ hash: result.hash, result: result.result });
          this.emitter?.emitEscrowReleased({ escrowId, hash: result.hash });
        } else {
          this.emitter?.emitFailed({
            hash: result.hash || txHash,
            error: result.error ?? 'Escrow release failed',
          });
        }

        return result;
      }

      return { hash: transaction.hash().toString('hex'), success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emitter?.emitFailed({ hash: '', error: message });
      return { hash: '', success: false, error: message };
    }
  }
    escrowId: string,
    signer: Keypair,
    options: PaymentOptions = {}
  ): Promise<TransactionResult> {
    try {
      const sourceAccount = await this.getSourceAccount(signer.publicKey());

      const escrowContract = this.client.getEscrowContract();
      const refundEscrowOp = escrowContract.call(
        'refund_escrow',
        xdr.ScVal.scvBytes(Buffer.from(escrowId, 'hex'))
      ) as unknown as Operation;

      const builder = await this.buildPaymentTransaction(
        sourceAccount,
        [refundEscrowOp],
        options
      );

      const transaction = builder.build();
      transaction.sign(signer);

      if (options.submit !== false) {
        const txHash = transaction.hash().toString('hex');
        this.emitter?.emitSubmitted({ hash: txHash, timestamp: Date.now() });

        const result = await this.client.submitTransaction(transaction.toXDR());

        if (result.success) {
          this.emitter?.emitConfirmed({ hash: result.hash, result: result.result });
          this.emitter?.emitEscrowRefunded({ escrowId, hash: result.hash });
        } else {
          this.emitter?.emitFailed({
            hash: result.hash || txHash,
            error: result.error ?? 'Escrow refund failed',
          });
        }

        return result;
      }

      return { hash: transaction.hash().toString('hex'), success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emitter?.emitFailed({ hash: '', error: message });
      return { hash: '', success: false, error: message };
    }
  }

  async disputeEscrow(
    escrowId: string,
    challenger: string,
    reason: string,
    evidence: Uint8Array,
    signer: Keypair,
    options: PaymentOptions = {}
  ): Promise<TransactionResult> {
    try {
      const sourceAccount = await this.getSourceAccount(signer.publicKey());

      const escrowContract = this.client.getEscrowContract();
      const disputeEscrowOp = escrowContract.call(
        'dispute_escrow',
        xdr.ScVal.scvBytes(Buffer.from(escrowId, 'hex')),
        new Address(challenger).toScVal(),
        xdr.ScVal.scvSymbol(reason),
        xdr.ScVal.scvBytes(Buffer.from(evidence))
      ) as unknown as Operation;

      const builder = await this.buildPaymentTransaction(
        sourceAccount,
        [disputeEscrowOp],
        options
      );

      const transaction = builder.build();
      transaction.sign(signer);

      if (options.submit !== false) {
        const txHash = transaction.hash().toString('hex');
        this.emitter?.emitSubmitted({ hash: txHash, timestamp: Date.now() });

        const result = await this.client.submitTransaction(transaction.toXDR());

        if (result.success) {
          this.emitter?.emitConfirmed({ hash: result.hash, result: result.result });
          this.emitter?.emitEscrowDisputed({ escrowId, hash: result.hash, challenger, reason });
        } else {
          this.emitter?.emitFailed({
            hash: result.hash || txHash,
            error: result.error ?? 'Escrow dispute failed',
          });
        }

        return result;
      }

      return { hash: transaction.hash().toString('hex'), success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emitter?.emitFailed({ hash: '', error: message });
      return { hash: '', success: false, error: message };
    }
  }

  async getExchangeRate(request: ExchangeRateRequest): Promise<ExchangeRateResult> {
    try {
      const rateKey = xdr.ScVal.scvVec([
        xdr.ScVal.scvSymbol(request.from_currency),
        xdr.ScVal.scvSymbol(request.to_currency),
      ]);

      const rateData = await this.client.getContractData(
        this.client.getContracts().rateOracle,
        rateKey
      );

      if (!rateData) {
        throw new Error(
          `Exchange rate not found for ${request.from_currency}/${request.to_currency}`
        );
      }

      const aggregatedRate = this.parseAggregatedRate(rateData);
      const sources = await this.getRateSources(
        request.from_currency,
        request.to_currency
      );

      return {
        rate: aggregatedRate.rate,
        timestamp: aggregatedRate.last_updated,
        sources,
        aggregated: aggregatedRate,
      };
    } catch (error) {
      throw new Error(
        `Failed to get exchange rate: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async checkCompliance(
    request: ComplianceRequest
  ): Promise<ComplianceCheckResult> {
    try {
      const complianceContract = this.client.getComplianceContract();
      const transactionId = this.generateTransactionId();

      const complianceOp = complianceContract.call(
        'check_transaction_compliance',
        xdr.ScVal.scvBytes(Buffer.from(transactionId, 'hex')),
        new Address(request.from_user).toScVal(),
        new Address(request.to_user).toScVal(),
        new ScInt(request.amount).toI128(),
        xdr.ScVal.scvSymbol(request.currency),
        xdr.ScVal.scvSymbol(request.jurisdiction_from),
        xdr.ScVal.scvSymbol(request.jurisdiction_to)
      );

      // simulateTransaction expects an XDR string; serialize the operation
      const result = await this.client.simulateTransaction(
        (complianceOp as unknown as { toXDR: () => string }).toXDR?.() ??
        JSON.stringify(complianceOp)
      );

      if (!result.results || result.results.length === 0) {
        throw new Error('Compliance check returned no results');
      }

      const complianceCheck = this.parseComplianceCheck(result.results[0]);

      return {
        hash: transactionId,
        success: true,
        approved: complianceCheck.approved,
        reason: complianceCheck.reason,
        rulesTriggered: complianceCheck.rules_triggered,
      };
    } catch (error) {
      return {
        hash: '',
        success: false,
        approved: false,
        reason:
          error instanceof Error ? error.message : 'Compliance check failed',
        rulesTriggered: [],
      };
    }
  }

  async getPaymentStatus(escrowId: string): Promise<PaymentStatus> {
    try {
      const escrow = await this.getEscrow(escrowId);
      const currentTime = Math.floor(Date.now() / 1000);

      return {
        escrowId: escrow.id,
        status: escrow.status,
        amount: escrow.amount,
        sender: escrow.sender,
        receiver: escrow.receiver,
        created_at: escrow.created_at,
        release_time: escrow.release_time,
        can_release:
          escrow.status === EscrowStatus.Pending &&
          currentTime >= escrow.release_time,
        can_refund: escrow.status === EscrowStatus.Pending,
      };
    } catch (error) {
      throw new Error(
        `Failed to get payment status: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async getEscrow(escrowId: string): Promise<Escrow> {
    try {
      const escrowKey = xdr.ScVal.scvBytes(Buffer.from(escrowId, 'hex'));

      const escrowData = await this.client.getContractData(
        this.client.getContracts().escrow,
        escrowKey
      );

      if (!escrowData) {
        throw new Error(`Escrow not found: ${escrowId}`);
      }

      return this.parseEscrow(escrowData);
    } catch (error) {
      throw new Error(
        `Failed to get escrow: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  async getUserEscrows(userAddress: string): Promise<string[]> {
    try {
      const userKey = xdr.ScVal.scvSymbol(`USER_ESCROWS_${userAddress}`);

      const escrowData = await this.client.getContractData(
        this.client.getContracts().escrow,
        userKey
      );

      if (!escrowData) return [];

      return this.parseEscrowList(escrowData);
    } catch (error) {
      throw new Error(
        `Failed to get user escrows: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private async getSourceAccount(accountId: string): Promise<Account> {
    const accountInfo = await this.client.getAccount(accountId);
    return new Account(accountId, accountInfo.sequence);
  }

  private convertMetadataToScVal(metadata: Record<string, Uint8Array>): xdr.ScVal {
    const entries = Object.entries(metadata).map(([key, value]) =>
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol(key),
        val: xdr.ScVal.scvBytes(Buffer.from(value)),
      })
    );
    return xdr.ScVal.scvMap(entries);
  }

  private extractEscrowIdFromResult(result: unknown): string {
    const r = result as Record<string, unknown>;
    if (r.result_xdr && typeof r.result_xdr === 'string') {
      const txResult = xdr.TransactionResult.fromXDR(r.result_xdr, 'base64');
      const opResults = txResult.result().results();
      if (opResults && opResults.length > 0) {
        // The inner result value — use any to avoid version-specific type issues
        const inner = (opResults[0] as any).value?.();
        if (inner && inner.switch?.() === xdr.ScValType.scvBytes()) {
          return Buffer.from(inner.bytes()).toString('hex');
        }
      }
    }
    return '';
  }

  private parseAggregatedRate(scVal: xdr.ScVal): AggregatedRate {
    if (scVal.switch() !== xdr.ScValType.scvMap()) {
      throw new Error('Invalid aggregated rate format');
    }

    const result: Partial<AggregatedRate> = {};
    const entries = scVal.map() ?? [];

    for (const entry of entries) {
      const key = entry.key().sym().toString();
      const value = entry.val();

      switch (key) {
        case 'rate':
          result.rate = new BigNumber(value.u128().toString()).toString();
          break;
        case 'weighted_average':
          result.weighted_average = new BigNumber(value.u128().toString()).toString();
          break;
        case 'sources_count':
          result.sources_count = value.u32();
          break;
        case 'last_updated':
          result.last_updated = Number(value.u64());
          break;
        case 'deviation_threshold':
          result.deviation_threshold = value.u32();
          break;
      }
    }

    return result as AggregatedRate;
  }

  private parseComplianceCheck(scVal: xdr.ScVal): ComplianceCheck {
    if (scVal.switch() !== xdr.ScValType.scvMap()) {
      throw new Error('Invalid compliance check format');
    }

    const result: Partial<ComplianceCheck> = {};
    const entries = scVal.map() ?? [];

    for (const entry of entries) {
      const key = entry.key().sym().toString();
      const value = entry.val();

      switch (key) {
        case 'transaction_id':
          result.transaction_id = Buffer.from(value.bytes()).toString('hex');
          break;
        case 'from_user':
          result.from_user = Address.fromScVal(value).toString();
          break;
        case 'to_user':
          result.to_user = Address.fromScVal(value).toString();
          break;
        case 'amount':
          result.amount = new BigNumber(value.i128().toString()).toString();
          break;
        case 'currency':
          result.currency = value.sym().toString();
          break;
        case 'jurisdiction_from':
          result.jurisdiction_from = value.sym().toString();
          break;
        case 'jurisdiction_to':
          result.jurisdiction_to = value.sym().toString();
          break;
        case 'timestamp':
          result.timestamp = Number(value.u64());
          break;
        case 'approved':
          result.approved = value.b();
          break;
        case 'reason':
          result.reason = value.sym().toString();
          break;
        case 'rules_triggered':
          result.rules_triggered = this.parseStringArray(value);
          break;
      }
    }

    return result as ComplianceCheck;
  }

  private parseEscrow(scVal: xdr.ScVal): Escrow {
    if (scVal.switch() !== xdr.ScValType.scvMap()) {
      throw new Error('Invalid escrow format');
    }

    const result: Partial<Escrow> = {};
    const entries = scVal.map() ?? [];

    for (const entry of entries) {
      const key = entry.key().sym().toString();
      const value = entry.val();

      switch (key) {
        case 'id':
          result.id = Buffer.from(value.bytes()).toString('hex');
          break;
        case 'sender':
          result.sender = Address.fromScVal(value).toString();
          break;
        case 'receiver':
          result.receiver = Address.fromScVal(value).toString();
          break;
        case 'amount':
          result.amount = new BigNumber(value.i128().toString()).toString();
          break;
        case 'token':
          result.token = Address.fromScVal(value).toString();
          break;
        case 'status':
          result.status = this.parseEscrowStatus(value);
          break;
        case 'release_time':
          result.release_time = Number(value.u64());
          break;
        case 'created_at':
          result.created_at = Number(value.u64());
          break;
        case 'metadata':
          result.metadata = this.parseMetadata(value);
          break;
      }
    }

    return result as Escrow;
  }

  private parseEscrowStatus(scVal: xdr.ScVal): EscrowStatus {
    const status = scVal.sym().toString();
    switch (status) {
      case 'Pending':   return EscrowStatus.Pending;
      case 'Completed': return EscrowStatus.Completed;
      case 'Refunded':  return EscrowStatus.Refunded;
      case 'Disputed':  return EscrowStatus.Disputed;
      default: throw new Error(`Unknown escrow status: ${status}`);
    }
  }

  private parseMetadata(scVal: xdr.ScVal): Record<string, Uint8Array> {
    if (scVal.switch() !== xdr.ScValType.scvMap()) return {};

    const result: Record<string, Uint8Array> = {};
    const entries = scVal.map() ?? [];

    for (const entry of entries) {
      const key = entry.key().sym().toString();
      const value = entry.val();
      if (value.switch() === xdr.ScValType.scvBytes()) {
        result[key] = value.bytes();
      }
    }

    return result;
  }

  private parseStringArray(scVal: xdr.ScVal): string[] {
    if (scVal.switch() !== xdr.ScValType.scvVec()) return [];

    const result: string[] = [];
    const items = scVal.vec() ?? [];

    for (const item of items) {
      if (item.switch() === xdr.ScValType.scvBytes()) {
        result.push(Buffer.from(item.bytes()).toString('hex'));
      }
    }
    return result;
  }

  private parseEscrowList(scVal: xdr.ScVal): string[] {
    return this.parseStringArray(scVal);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async getRateSources(_from: string, _to: string): Promise<never[]> {
    // Placeholder — real impl queries individual oracle sources
    return [];
  }

  private generateTransactionId(): string {
    return Buffer.from(Math.random().toString(36).substring(2, 15)).toString('hex');
  }
}
