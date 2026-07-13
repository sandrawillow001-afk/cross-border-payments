import { StellarClient } from './client';
import { Networks, Account, BASE_FEE, Keypair } from 'stellar-sdk';

describe('StellarClient buildTransaction', () => {
  it('uses the fee bump fee when requested', async () => {
    const client = new StellarClient(
      {
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: 'https://rpc-futurenet.stellar.org',
        networkPassphrase: Networks.TESTNET,
      },
      {
        escrow: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        rateOracle: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        compliance: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }
    );

    const sourceAccount = new Account(Keypair.random().publicKey(), '1');
    const builder = await client.buildTransaction(sourceAccount, [], {
      feeBump: true,
    });

    expect(builder.baseFee).toBe('2000');
  });

  it('keeps the standard base fee when fee bump is not requested', async () => {
    const client = new StellarClient(
      {
        horizonUrl: 'https://horizon-testnet.stellar.org',
        sorobanRpcUrl: 'https://rpc-futurenet.stellar.org',
        networkPassphrase: Networks.TESTNET,
      },
      {
        escrow: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        rateOracle: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        compliance: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      }
    );

    const sourceAccount = new Account(Keypair.random().publicKey(), '1');
    const builder = await client.buildTransaction(sourceAccount, [], {});

    expect(builder.baseFee).toBe(BASE_FEE);
  });
});
