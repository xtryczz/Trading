import type { Config } from "./config.js";
import type { Executor } from "./executor.js";
import { PositionStore } from "./positions.js";
import type { WatchedSignal } from "./watcher.js";
import { fmt, record, say, short } from "./logger.js";

export class Engine {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(
    private cfg: Config,
    private exec: Executor,
    private store: PositionStore,
  ) {}

  /** Všechny akce běží postupně (žádné souběžné změny pozic). */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  onSignal(s: WatchedSignal) {
    return this.serial(() => this.handleSignal(s));
  }

  private skip(s: WatchedSignal, reason: string) {
    say(`⏭️  Přeskakuji ${s.kind === "buy" ? "nákup" : "prodej"} ${short(s.mint)} od ${s.traderName}: ${reason}`);
    record({ type: "skip", mode: this.cfg.mode, trader: s.traderName, kind: s.kind, mint: s.mint, reason, signature: s.signature });
  }

  private async handleSignal(s: WatchedSignal) {
    say(
      `📡 ${s.traderName} ${s.kind === "buy" ? "KOUPIL" : "PRODAL"} ${short(s.mint)} za ${fmt(s.solAmount, 3)} SOL` +
        (s.fractionSold !== undefined ? ` (${fmt(s.fractionSold * 100, 0)} % pozice)` : ""),
    );
    record({ type: "signal", mode: this.cfg.mode, trader: s.traderName, kind: s.kind, mint: s.mint, solAmount: s.solAmount, tokenAmount: s.tokenAmount, priceSol: s.priceSol, fractionSold: s.fractionSold, signature: s.signature });
    try {
      if (s.kind === "buy") await this.copyBuy(s);
      else await this.copySell(s);
    } catch (e) {
      this.skip(s, `chyba: ${(e as Error).message}`);
    }
  }

  private async copyBuy(s: WatchedSignal) {
    const c = this.cfg;
    if (s.solAmount < c.minTraderBuySol) return this.skip(s, `trader koupil jen za ${fmt(s.solAmount, 3)} SOL (min ${c.minTraderBuySol})`);
    if (this.store.get(s.mint)) return this.skip(s, "tento token už držíme");
    if (this.store.all().length >= c.maxOpenPositions) return this.skip(s, `max. počet pozic (${c.maxOpenPositions})`);
    if (this.store.totalCostSol() + c.buyAmountSol > c.maxTotalSolAtRisk)
      return this.skip(s, `překročil by se MAX_TOTAL_SOL_AT_RISK (${c.maxTotalSolAtRisk} SOL)`);

    const prev = await this.exec.preview(s.mint, s.decimals, c.buyAmountSol);
    const drift = (prev.priceSol / s.priceSol - 1) * 100;
    if (drift > c.maxPriceDriftPct)
      return this.skip(s, `naše cena je o ${fmt(drift, 1)} % vyšší než traderova (limit ${c.maxPriceDriftPct} %)`);

    const r = await this.exec.buy(s.mint, s.decimals, c.buyAmountSol);
    const openedAt = new Date().toISOString();
    this.store.add({
      id: `${s.mint}-${openedAt}`,
      mint: s.mint,
      decimals: s.decimals,
      tokens: r.tokens,
      costSol: r.solSpent,
      entryPriceSol: r.priceSol,
      trader: s.traderName,
      traderAddress: s.trader,
      openedAt,
      mode: c.mode,
    });
    say(`🟢 ${c.mode === "paper" ? "[PAPER] " : ""}KOUPENO ${short(s.mint)} za ${fmt(r.solSpent, 3)} SOL (cena ${r.priceSol.toExponential(3)} SOL/token, drift ${fmt(drift, 1)} %)`);
    record({ type: "buy", mode: c.mode, positionId: `${s.mint}-${openedAt}`, trader: s.traderName, mint: s.mint, solSpent: r.solSpent, tokens: r.tokens, priceSol: r.priceSol, traderPriceSol: s.priceSol, driftPct: drift, txSignature: r.txSignature });
  }

  private async copySell(s: WatchedSignal) {
    if (!this.cfg.mirrorSells) return this.skip(s, "MIRROR_SELLS=false");
    const pos = this.store.get(s.mint);
    if (!pos) return this.skip(s, "tento token nedržíme");
    if (pos.traderAddress !== s.trader) return this.skip(s, `pozici kopírujeme od ${pos.trader}, ne od ${s.traderName}`);
    await this.sellPosition(pos.mint, s.fractionSold ?? 1, `trader ${s.traderName} prodal`);
  }

  /** Prodá `fraction` (0..1) pozice. Při ≥ 0,98 zavře celou. */
  private async sellPosition(mint: string, fraction: number, reason: string) {
    const pos = this.store.get(mint);
    if (!pos) return;
    const full = fraction >= 0.98;
    const tokens = full ? pos.tokens : pos.tokens * fraction;
    const costPart = full ? pos.costSol : pos.costSol * fraction;
    const r = await this.exec.sell(mint, pos.decimals, tokens);
    const pnl = r.solReceived - costPart;
    if (full) this.store.remove(mint);
    else {
      pos.tokens -= tokens;
      pos.costSol -= costPart;
      this.store.save();
    }
    say(`🔴 ${this.cfg.mode === "paper" ? "[PAPER] " : ""}PRODÁNO ${full ? "vše" : fmt(fraction * 100, 0) + " %"} z ${short(mint)}: ${fmt(r.solReceived, 4)} SOL, výsledek ${pnl >= 0 ? "+" : ""}${fmt(pnl, 4)} SOL (${reason})`);
    record({ type: "sell", mode: this.cfg.mode, positionId: pos.id, trader: pos.trader, mint, fraction: full ? 1 : fraction, closed: full, solReceived: r.solReceived, costSol: costPart, pnlSol: pnl, reason, txSignature: r.txSignature });
  }

  /** Volá se každých PRICE_CHECK_INTERVAL_SEC: stop-loss / take-profit. */
  checkExits() {
    return this.serial(async () => {
      for (const pos of [...this.store.all()]) {
        try {
          const value = await this.exec.value(pos.mint, pos.decimals, pos.tokens);
          const pct = (value / pos.costSol - 1) * 100;
          say(`📈 ${short(pos.mint)} (${pos.trader}): ${fmt(value, 4)} SOL vs. cena ${fmt(pos.costSol, 4)} SOL = ${pct >= 0 ? "+" : ""}${fmt(pct, 1)} %`);
          if (pct >= this.cfg.takeProfitPct) await this.sellPosition(pos.mint, 1, `take-profit ${fmt(pct, 1)} %`);
          else if (pct <= -this.cfg.stopLossPct) await this.sellPosition(pos.mint, 1, `stop-loss ${fmt(pct, 1)} %`);
        } catch (e) {
          say(`⚠️  Nacenění ${short(pos.mint)} selhalo: ${(e as Error).message}`);
        }
      }
    });
  }
}
