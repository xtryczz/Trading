import "dotenv/config";

export interface Trader {
  name: string;
  address: string;
}

function str(key: string, def = ""): string {
  const v = process.env[key];
  return v === undefined || v.trim() === "" ? def : v.trim();
}

function num(key: string, def: number): number {
  const v = process.env[key];
  if (v === undefined || v.trim() === "") return def;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Hodnota ${key} v .env není číslo: "${v}"`);
  return n;
}

function bool(key: string, def: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v.trim() === "") return def;
  return ["1", "true", "yes", "ano"].includes(v.trim().toLowerCase());
}

function parseTraders(raw: string): Trader[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((item, i) => {
      const idx = item.indexOf(":");
      if (idx === -1) return { name: `Trader${i + 1}`, address: item };
      return { name: item.slice(0, idx).trim(), address: item.slice(idx + 1).trim() };
    });
}

export function loadConfig() {
  const mode = str("MODE", "paper");
  if (mode !== "paper" && mode !== "live") {
    throw new Error(`MODE musí být "paper" nebo "live", ne "${mode}"`);
  }
  const key = str("HELIUS_API_KEY");
  const rpcUrl = str("RPC_URL", key ? `https://mainnet.helius-rpc.com/?api-key=${key}` : "");
  const wsUrl = str("WS_URL", key ? `wss://mainnet.helius-rpc.com/?api-key=${key}` : "");
  if (!rpcUrl || !wsUrl) {
    throw new Error("Chybí HELIUS_API_KEY (nebo RPC_URL a WS_URL) v souboru .env");
  }
  const traders = parseTraders(str("TRADERS"));
  if (traders.length === 0) throw new Error("V .env je prázdné TRADERS – doplň aspoň jednu adresu.");

  return {
    mode: mode as "paper" | "live",
    rpcUrl,
    wsUrl,
    traders,
    buyAmountSol: num("BUY_AMOUNT_SOL", 0.05),
    minTraderBuySol: num("MIN_TRADER_BUY_SOL", 0.5),
    maxOpenPositions: num("MAX_OPEN_POSITIONS", 5),
    maxTotalSolAtRisk: num("MAX_TOTAL_SOL_AT_RISK", 0.3),
    maxPriceDriftPct: num("MAX_PRICE_DRIFT_PCT", 25),
    slippageBps: num("SLIPPAGE_BPS", 300),
    priorityFeeLamports: num("PRIORITY_FEE_LAMPORTS", 100000),
    jupiterUrl: str("JUPITER_URL", "https://lite-api.jup.ag").replace(/\/$/, ""),
    jupiterApiKey: str("JUPITER_API_KEY"),
    mirrorSells: bool("MIRROR_SELLS", true),
    takeProfitPct: num("TAKE_PROFIT_PCT", 100),
    stopLossPct: num("STOP_LOSS_PCT", 40),
    priceCheckIntervalSec: num("PRICE_CHECK_INTERVAL_SEC", 30),
    positionsFile: str("POSITIONS_FILE", "positions.json"),
    tradesFile: str("TRADES_FILE", "trades.jsonl"),
    // Soukromý klíč se čte až ve fázi 4 a nikdy se nikam nevypisuje.
    privateKey: str("PRIVATE_KEY"),
  };
}

export type Config = ReturnType<typeof loadConfig>;

/** Pro watch mód stačí jen připojení a tradeři. */
export function loadWatchConfig() {
  const c = loadConfig();
  return { rpcUrl: c.rpcUrl, wsUrl: c.wsUrl, traders: c.traders };
}
