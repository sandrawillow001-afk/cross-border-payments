import { useEffect, useState } from "react";
import {
  connectWallet,
  disconnectWallet,
  getActiveAddress,
  getFreighterNetwork,
  signWithFreighter,
} from "./wallet";
import {
  getXlmBalance,
  buildPaymentXdr,
  submitSignedTx,
  fundWithFriendbot,
  NETWORK_NAME,
  NETWORK_PASSPHRASE,
  HORIZON_URL,
} from "./stellar";

type Feedback =
  | { kind: "idle" }
  | { kind: "pending"; msg: string }
  | { kind: "success"; hash: string }
  | { kind: "error"; msg: string };

export default function App() {
  const [address, setAddress] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("1");
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const [loadingBalance, setLoadingBalance] = useState(false);

  // Reconnect on load if Freighter already knows this app
  useEffect(() => {
    (async () => {
      const a = await getActiveAddress();
      if (a) {
        setAddress(a);
        const net = await getFreighterNetwork();
        setNetwork(net?.network ?? null);
      }
    })();
  }, []);

  const refreshBalance = async (pub: string) => {
    setLoadingBalance(true);
    try {
      setBalance(await getXlmBalance(pub));
    } catch (e: any) {
      setBalance(null);
      setFeedback({ kind: "error", msg: `Balance fetch failed: ${e.message ?? e}` });
    } finally {
      setLoadingBalance(false);
    }
  };

  const onConnect = async () => {
    setFeedback({ kind: "pending", msg: "Requesting Freighter access…" });
    const res = await connectWallet();
    if (res.error) {
      setFeedback({ kind: "error", msg: res.error });
      return;
    }
    setAddress(res.address!);
    const net = await getFreighterNetwork();
    setNetwork(net?.network ?? null);
    setFeedback({ kind: "idle" });
    await refreshBalance(res.address!);
  };

  const onDisconnect = async () => {
    await disconnectWallet();
    setAddress(null);
    setNetwork(null);
    setBalance(null);
    setFeedback({ kind: "idle" });
  };

  const onFund = async () => {
    if (!address) return;
    setFeedback({ kind: "pending", msg: "Funding with Friendbot…" });
    try {
      await fundWithFriendbot(address);
      await refreshBalance(address);
      setFeedback({ kind: "success", hash: "funded" });
    } catch (e: any) {
      setFeedback({ kind: "error", msg: `Friendbot failed: ${e.message ?? e}` });
    }
  };

  const onSend = async () => {
    if (!address) return;
    if (!destination) {
      setFeedback({ kind: "error", msg: "Enter a destination public key." });
      return;
    }
    if (!amount || Number(amount) <= 0) {
      setFeedback({ kind: "error", msg: "Enter a valid XLM amount." });
      return;
    }
    setFeedback({ kind: "pending", msg: "Building & signing transaction…" });
    try {
      const xdr = await buildPaymentXdr(address, destination.trim(), amount);
      const signed = await signWithFreighter(xdr, NETWORK_PASSPHRASE);
      if (signed.error) throw new Error(signed.error);
      setFeedback({ kind: "pending", msg: "Submitting to testnet…" });
      const res = await submitSignedTx(signed.signedTxXdr!);
      setFeedback({ kind: "success", hash: res.hash });
      await refreshBalance(address);
    } catch (e: any) {
      const msg = typeof e === "string" ? e : e?.message ?? JSON.stringify(e);
      setFeedback({ kind: "error", msg: `Transaction failed: ${msg}` });
    }
  };

  return (
    <div className="app">
      <header>
        <h1>Stellar Level 1 — Freighter Wallet</h1>
        <p className="muted">
          Network: <strong>{network ?? "—"}</strong> · Required: {NETWORK_NAME}
        </p>
      </header>

      {/* 2. Wallet Connection */}
      <section className="card">
        <h2>Wallet</h2>
        {!address ? (
          <button className="primary" onClick={onConnect}>Connect Freighter</button>
        ) : (
          <div>
            <div className="row"><span>Address:</span><code>{address}</code></div>
            <div className="row">
              <span>Network:</span>
              <span className={network === NETWORK_NAME ? "ok" : "warn"}>
                {network ?? "unknown"}{network !== NETWORK_NAME ? " (switch Freighter to Testnet!)" : ""}
              </span>
            </div>
            <div className="actions">
              <button onClick={onDisconnect}>Disconnect</button>
            </div>
          </div>
        )}
      </section>

      {/* 3. Balance Handling */}
      <section className="card">
        <h2>Balance</h2>
        {address ? (
          <div>
            <div className="row big"><span>XLM:</span><strong>{loadingBalance ? "loading…" : balance ?? "—"}</strong></div>
            <div className="actions">
              <button onClick={() => refreshBalance(address)}>Refresh balance</button>
              <button onClick={onFund}>Fund with Friendbot</button>
            </div>
          </div>
        ) : <p className="muted">Connect a wallet to view its XLM balance.</p>}
      </section>

      {/* 4. Transaction Flow */}
      <section className="card">
        <h2>Send XLM (Testnet)</h2>
        {address ? (
          <div className="form">
            <label>Destination public key
              <input value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="G…" />
            </label>
            <label>Amount (XLM)
              <input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min="0" step="0.1" />
            </label>
            <button className="primary" onClick={onSend}>Send XLM</button>
          </div>
        ) : <p className="muted">Connect a wallet to send XLM.</p>}
      </section>

      {/* 4. Transaction feedback */}
      <section className="card">
        <h2>Feedback</h2>
        {feedback.kind === "idle" && <p className="muted">No transaction yet.</p>}
        {feedback.kind === "pending" && <p className="info">{feedback.msg}</p>}
        {feedback.kind === "success" && (
          <p className="ok">✅ Success{feedback.hash === "funded" ? "" : " — tx hash:"}{" "}
            {feedback.hash !== "funded" && <a href={`https://stellar.expert/explorer/testnet/tx/${feedback.hash}`} target="_blank" rel="noreferrer"><code>{feedback.hash}</code></a>}
          </p>
        )}
        {feedback.kind === "error" && <p className="err">❌ {feedback.msg}</p>}
      </section>

      {/* 5. Development standards / config */}
      <section className="card meta">
        <h2>Configuration</h2>
        <ul>
          <li>Network: {NETWORK_NAME}</li>
          <li>Passphrase: <code>{NETWORK_PASSPHRASE}</code></li>
          <li>Horizon: <code>{HORIZON_URL}</code></li>
          <li>Wallet: Freighter (<code>@stellar/freighter-api</code>)</li>
        </ul>
      </section>
    </div>
  );
}
