// Stellar testnet helpers using stellar-sdk.
// 1. Wallet Setup → Stellar Testnet
import {
  Horizon,
  TransactionBuilder,
  Transaction,
  Networks,
  Operation,
  Asset,
} from "stellar-sdk";

// 1. Stellar Testnet configuration
export const HORIZON_URL = "https://horizon-testnet.stellar.org";
export const NETWORK_PASSPHRASE = Networks.TESTNET;
export const NETWORK_NAME = "TESTNET";

const server = new Horizon.Server(HORIZON_URL);

/** 3. Fetch the connected wallet's XLM balance. */
export async function getXlmBalance(publicKey: string): Promise<string> {
  const account = await server.accounts().accountId(publicKey).call();
  const xlm = (account.balances as any[]).find((b) => b.asset_type === "native");
  return xlm ? (xlm.balance as string) : "0";
}

/** 4. Build a native (XLM) payment transaction on testnet and return its XDR. */
export async function buildPaymentXdr(
  source: string,
  destination: string,
  amount: string
): Promise<string> {
  const account = await server.loadAccount(source);
  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: Asset.native(),
        amount,
      })
    )
    .setTimeout(60)
    .build();
  return tx.toXDR();
}

/** 4. Submit a signed transaction to testnet and return the result (incl. hash). */
export async function submitSignedTx(
  signedXdr: string
): Promise<{ hash: string; result: any }> {
  const tx = new Transaction(signedXdr, NETWORK_PASSPHRASE);
  const res = await server.submitTransaction(tx);
  return { hash: res.hash, result: res };
}

/** Fund a testnet account with Friendbot (dev helper). */
export async function fundWithFriendbot(publicKey: string): Promise<void> {
  await fetch(`https://friendbot.stellar.org?addr=${publicKey}`);
}
