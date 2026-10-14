import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../engine.js";
import { PositionStore } from "../positions.js";
import { initLogger } from "../logger.js";

const dir = mkdtempSync(join(tmpdir(), "copybot-"));
initLogger(join(dir, "trades.jsonl"));
const cfg: any = { mode: "paper", buyAmountSol: 0.05, minTraderBuySol: 0.5, maxOpenPositions: 2, maxTotalSolAtRisk: 0.3, maxPriceDriftPct: 25, mirrorSells: true, takeProfitPct: 100, stopLossPct: 40 };
let price = 0.001; // SOL/token
const exec: any = {
  preview: async () => ({ tokens: 0.05 / price, priceSol: price }),
  buy: async () => ({ tokens: 0.05 / price, solSpent: 0.05, priceSol: price }),
  sell: async (_m: string, _d: number, t: number) => ({ solReceived: t * price }),
  value: async (_m: string, _d: number, t: number) => t * price,
};
const store = new PositionStore(join(dir, "pos.json"));
const eng = new Engine(cfg, exec, store);
const sig = (o: any) => ({ trader: "A", traderName: "A", mint: "M1", decimals: 6, solAmount: 1, tokenAmount: 1000, priceSol: 0.001, signature: "s", kind: "buy", ...o });

await eng.onSignal(sig({}));
assert.equal(store.all().length, 1);
await eng.onSignal(sig({}));                       // už držíme
assert.equal(store.all().length, 1);
await eng.onSignal(sig({ mint: "M2", solAmount: 0.1 })); // malý nákup
assert.equal(store.all().length, 1);
await eng.onSignal(sig({ mint: "M3", priceSol: 0.0005 })); // drift 100 %
assert.equal(store.all().length, 1);
await eng.onSignal(sig({ kind: "sell", fractionSold: 0.5 }));
assert.ok(Math.abs(store.get("M1")!.costSol - 0.025) < 1e-9);
price = 0.002; await eng.checkExits();            // +100 % → take-profit
assert.equal(store.all().length, 0);
const lines = readFileSync(join(dir, "trades.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
assert.ok(lines.some((l) => l.type === "sell" && l.closed && l.pnlSol > 0));
console.log("✅ engine: všechny testy prošly");
