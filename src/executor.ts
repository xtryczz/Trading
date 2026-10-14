import type { Config } from "./config.js";
import { quoteBuy, quoteSell } from "./jupiter.js";

export interface BuyResult {
  tokens: number;
  solSpent: number;
  priceSol: number;
  txSignature?: string;
}
export interface SellResult {
  solReceived: number;
  txSignature?: string;
}

/** Rozhraní, přes které engine nakupuje/prodává. Paper = simulace, Live = fáze 4. */
export interface Executor {
  /** Jen nacení nákupu (bez odeslání) – pro filtr "price drift". */
  preview(mint: string, decimals: number, solAmount: number): Promise<{ tokens: number; priceSol: number }>;
  buy(mint: string, decimals: number, solAmount: number): Promise<BuyResult>;
  sell(mint: string, decimals: number, tokens: number): Promise<SellResult>;
  /** Odhad hodnoty pozice v SOL (quote, nic se neposílá). */
  value(mint: string, decimals: number, tokens: number): Promise<number>;
}

/** Simulace: bere ceny z Jupiter quote, nic neposílá do blockchainu. */
export class PaperExecutor implements Executor {
  constructor(private cfg: Config) {}
  async preview(mint: string, decimals: number, solAmount: number) {
    const q = await quoteBuy(this.cfg, mint, decimals, solAmount);
    return { tokens: q.tokens, priceSol: q.priceSol };
  }
  async buy(mint: string, decimals: number, solAmount: number): Promise<BuyResult> {
    const q = await quoteBuy(this.cfg, mint, decimals, solAmount);
    return { tokens: q.tokens, solSpent: solAmount, priceSol: q.priceSol };
  }
  async sell(mint: string, decimals: number, tokens: number): Promise<SellResult> {
    const q = await quoteSell(this.cfg, mint, decimals, tokens);
    return { solReceived: q.solOut };
  }
  async value(mint: string, decimals: number, tokens: number) {
    return (await quoteSell(this.cfg, mint, decimals, tokens)).solOut;
  }
}

/**
 * FÁZE 4 (zatím neimplementováno): skutečné swapy přes Jupiter POST /swap/v1/swap,
 * podpis VersionedTransaction, odeslání, potvrzení. Viz README, sekce "Fáze 4".
 */
export class LiveExecutor implements Executor {
  constructor(_cfg: Config) {
    throw new Error("Live mód zatím není implementován (fáze 4).");
  }
  preview(): Promise<never> { throw new Error("not implemented"); }
  buy(): Promise<never> { throw new Error("not implemented"); }
  sell(): Promise<never> { throw new Error("not implemented"); }
  value(): Promise<never> { throw new Error("not implemented"); }
}
