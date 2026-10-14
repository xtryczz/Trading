import { Connection, PublicKey } from "@solana/web3.js";
import type { Trader } from "./config.js";
import { detectSwap, type SwapSignal } from "./swapDetect.js";
import { say } from "./logger.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface WatchedSignal extends SwapSignal {
  traderName: string;
}

/**
 * Sleduje peněženky přes WebSocket (onLogs, "confirmed").
 * @solana/web3.js při výpadku spojení se připojí znovu a obnoví odběry samo;
 * navíc hlídáme zdraví RPC a hlásíme výpadky.
 */
export function startWatcher(
  rpcUrl: string,
  wsUrl: string,
  traders: Trader[],
  onSignal: (s: WatchedSignal) => void | Promise<void>,
) {
  const connection = new Connection(rpcUrl, { wsEndpoint: wsUrl, commitment: "confirmed" });
  const seen = new Set<string>();

  async function fetchTx(signature: string) {
    // Transakce nemusí být hned dostupná – zkusíme několikrát.
    for (let i = 0; i < 6; i++) {
      try {
        const tx = await connection.getParsedTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
        if (tx) return tx;
      } catch (e) {
        say(`⚠️  Chyba při stahování transakce (${(e as Error).message}), zkouším znovu…`);
      }
      await sleep(1000 * (i + 1));
    }
    return null;
  }

  async function handle(signature: string) {
    const tx = await fetchTx(signature);
    if (!tx) {
      say(`⚠️  Transakci ${signature.slice(0, 8)}… se nepodařilo stáhnout.`);
      return;
    }
    // Jedna transakce může zmiňovat víc traderů – zkusíme každého.
    for (const t of traders) {
      const sig = detectSwap(tx, t.address, signature);
      if (sig) await onSignal({ ...sig, traderName: t.name });
    }
  }

  for (const t of traders) {
    new PublicKey(t.address); // ověří, že adresa je platná
    connection.onLogs(
      new PublicKey(t.address),
      (logs) => {
        if (logs.err) return;
        if (seen.has(logs.signature)) return;
        seen.add(logs.signature);
        if (seen.size > 5000) seen.delete(seen.values().next().value as string);
        handle(logs.signature).catch((e) => say(`⚠️  Chyba: ${(e as Error).message}`));
      },
      "confirmed",
    );
    say(`👀 Sleduji ${t.name} (${t.address})`);
  }

  // Hlídač zdraví spojení
  let down = false;
  setInterval(async () => {
    try {
      await connection.getSlot();
      if (down) say("✅ Spojení s RPC obnoveno.");
      down = false;
    } catch (e) {
      if (!down) say(`❌ RPC nedostupné (${(e as Error).message}). Čekám na obnovení…`);
      down = true;
    }
  }, 30_000);

  return connection;
}

