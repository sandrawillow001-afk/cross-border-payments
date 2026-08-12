// Wallet integration using the Freighter browser extension.
// Docs: https://developers.stellar.org/docs/build/freighter
import {
  requestAccess,
  getAddress,
  getNetworkDetails,
  isConnected,
  signTransaction,
} from "@stellar/freighter-api";

export type NetworkInfo = {
  network: string;
  networkPassphrase: string;
  networkUrl: string;
};

export async function isFreighterConnected(): Promise<boolean> {
  try {
    const r = await isConnected();
    return !!r.isConnected;
  } catch {
    return false;
  }
}

/** 2a. Connect — request access to the user's Freighter wallet and return the public key. */
export async function connectWallet(): Promise<{ address?: string; error?: string }> {
  if (!(await isFreighterConnected())) {
    return {
      error:
        "Freighter wallet not detected. Install it from https://www.freighter.app/ and set the network to Testnet.",
    };
  }
  const res = await requestAccess();
  if (res.error) return { error: String(res.error) };
  return { address: res.address };
}

/** Return the currently-active Freighter address (without prompting). */
export async function getActiveAddress(): Promise<string | null> {
  const res = await getAddress();
  if (res.error) return null;
  return res.address ?? null;
}

/** 2b. Disconnect — Freighter manages its own allow-list; the dApp forgets the connection. */
export async function disconnectWallet(): Promise<void> {
  // No reliable revoke RPC in freighter-api; the caller clears local state.
  return;
}

/** Read the network Freighter is currently set to (we require Testnet). */
export async function getFreighterNetwork(): Promise<NetworkInfo | null> {
  const res = await getNetworkDetails();
  if (res.error) return null;
  return {
    network: res.network,
    networkPassphrase: res.networkPassphrase,
    networkUrl: res.networkUrl,
  };
}

/** Sign an XDR transaction with Freighter. */
export async function signWithFreighter(
  xdr: string,
  networkPassphrase: string
): Promise<{ signedTxXdr?: string; error?: string }> {
  const res = await signTransaction(xdr, { networkPassphrase });
  if (res.error) return { error: String(res.error) };
  return { signedTxXdr: res.signedTxXdr };
}
