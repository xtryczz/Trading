import { appendFileSync } from "node:fs";

let tradesFile = "trades.jsonl";
export function initLogger(file: string) {
  tradesFile = file;
}

export function say(msg: string) {
  const t = new Date().toLocaleTimeString("cs-CZ");
  console.log(`[${t}] ${msg}`);
}

/** Zapíše jeden záznam (signál, obchod, přeskočení...) do trades.jsonl */
export function record(entry: Record<string, unknown>) {
  appendFileSync(tradesFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

export const short = (s: string) => (s.length > 10 ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);
export const fmt = (n: number, d = 4) => n.toFixed(d);
