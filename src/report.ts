import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";

const file = process.env.TRADES_FILE || "trades.jsonl";
if (!existsSync(file)) {
  console.log(`Soubor ${file} zatím neexistuje – bot ještě nic nezaznamenal.`);
  process.exit(0);
}

type Ev = Record<string, any>;
const events: Ev[] = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const buys = events.filter((e) => e.type === "buy");
const sells = events.filter((e) => e.type === "sell");
const skips = events.filter((e) => e.type === "skip");
const signals = events.filter((e) => e.type === "signal");

// Pozice = součet výsledků všech prodejů se stejným positionId; uzavřená = má prodej s closed=true
const positions = new Map<string, { trader: string; pnl: number; closed: boolean }>();
for (const s of sells) {
  const p = positions.get(s.positionId) ?? { trader: s.trader, pnl: 0, closed: false };
  p.pnl += s.pnlSol;
  p.closed ||= s.closed;
  positions.set(s.positionId, p);
}
const closed = [...positions.values()].filter((p) => p.closed);
const wins = closed.filter((p) => p.pnl > 0).length;
const total = closed.reduce((s, p) => s + p.pnl, 0);
const f = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(4)} SOL`;

console.log("\n===== SOUHRN PAPER TRADINGU =====");
console.log(`Signálů od traderů:     ${signals.length}`);
console.log(`Simulovaných nákupů:    ${buys.length}`);
console.log(`Uzavřených pozic:       ${closed.length}`);
console.log(`Otevřených pozic:       ${buys.length - closed.length}`);
console.log(`Win rate:               ${closed.length ? ((wins / closed.length) * 100).toFixed(1) + " %" : "–"} (${wins}/${closed.length})`);
console.log(`Celkový zisk/ztráta:    ${f(total)}`);

console.log("\n--- Podle tradera ---");
const byTrader = new Map<string, { n: number; w: number; pnl: number }>();
for (const p of closed) {
  const t = byTrader.get(p.trader) ?? { n: 0, w: 0, pnl: 0 };
  t.n++;
  if (p.pnl > 0) t.w++;
  t.pnl += p.pnl;
  byTrader.set(p.trader, t);
}
if (byTrader.size === 0) console.log("(zatím žádná uzavřená pozice)");
for (const [name, t] of byTrader) {
  console.log(`${name.padEnd(16)} obchodů ${t.n}, win rate ${((t.w / t.n) * 100).toFixed(0)} %, ${f(t.pnl)}`);
}

console.log("\n--- Proč jsme přeskočili ---");
const reasons = new Map<string, number>();
for (const s of skips) {
  const key = String(s.reason).replace(/[0-9.]+/g, "#");
  reasons.set(key, (reasons.get(key) ?? 0) + 1);
}
if (reasons.size === 0) console.log("(nic nepřeskočeno)");
for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(4)}×  ${r}`);
console.log();
