import { loadConfig, loadWatchConfig } from "./config.js";
import { initLogger, say } from "./logger.js";
import { startWatcher } from "./watcher.js";
import { PositionStore } from "./positions.js";
import { Engine } from "./engine.js";
import { LiveExecutor, PaperExecutor, fetchDecimals } from "./executor.js";

async function main() {
  const cmd = process.argv[2] ?? "run";

  if (cmd === "watch") {
    // Fáze 2: jen sledování, nic nekupuje.
    const c = loadWatchConfig();
    say("👁️  Režim SLEDOVÁNÍ – bot nic nekupuje, jen vypisuje obchody traderů.");
    startWatcher(c.rpcUrl, c.wsUrl, c.traders, (s) => {
      say(
        `📡 ${s.traderName} ${s.kind === "buy" ? "KOUPIL" : "PRODAL"} token ${s.mint} za ${s.solAmount.toFixed(3)} SOL` +
          ` (${s.tokenAmount.toFixed(2)} tokenů, cena ${s.priceSol.toExponential(3)} SOL)` +
          (s.fractionSold !== undefined ? ` – ${(s.fractionSold * 100).toFixed(0)} % pozice` : "") +
          `\n      https://solscan.io/tx/${s.signature}`,
      );
    });
    return;
  }

  if (cmd === "test-trade") {
    // Fáze 4: jeden malý skutečný obchod (koupí a hned prodá), než pustíš celého bota.
    const mint = process.argv[3];
    if (!mint) throw new Error("Použití: npm run test-trade -- <adresa tokenu>");
    const cfg = loadConfig();
    initLogger(cfg.tradesFile);
    if (cfg.mode !== "live") throw new Error("test-trade posílá skutečné transakce: nastav MODE=live v .env.");
    const amount = Number(process.argv[4] ?? 0.005);
    console.log(`\n!!! TESTOVACÍ OBCHOD: koupím za ${amount} SOL a hned prodám. Ctrl+C do 10 s ruší. !!!\n`);
    await new Promise((r) => setTimeout(r, 10_000));
    const exec = new LiveExecutor(cfg);
    const dec = await fetchDecimals(cfg.rpcUrl, mint);
    const b = await exec.buy(mint, dec, amount);
    say(`✅ Koupeno ${b.tokens} tokenů za ${b.solSpent.toFixed(5)} SOL`);
    const s = await exec.sell(mint, dec, b.tokens);
    say(`✅ Prodáno za ${s.solReceived.toFixed(5)} SOL (rozdíl ${(s.solReceived - b.solSpent).toFixed(5)} SOL = poplatky a prokluz)`);
    return;
  }

  if (cmd !== "run") throw new Error(`Neznámý příkaz "${cmd}". Použij: watch | run | test-trade`);

  const cfg = loadConfig();
  initLogger(cfg.tradesFile);

  if (cfg.mode === "live") {
    console.log("\n" + "!".repeat(60));
    console.log("!!!  POZOR: MODE=live – bot bude posílat SKUTEČNÉ obchody  !!!");
    console.log("!!!  Pro zrušení stiskni Ctrl+C. Start za 10 sekund...    !!!");
    console.log("!".repeat(60) + "\n");
    await new Promise((r) => setTimeout(r, 10_000));
  }

  const exec = cfg.mode === "live" ? new LiveExecutor(cfg) : new PaperExecutor(cfg);
  const store = new PositionStore(cfg.positionsFile);
  const engine = new Engine(cfg, exec, store);

  say(`🤖 Start v módu ${cfg.mode.toUpperCase()}. Otevřených pozic: ${store.all().length}`);
  startWatcher(cfg.rpcUrl, cfg.wsUrl, cfg.traders, (s) => engine.onSignal(s));
  setInterval(() => engine.checkExits(), cfg.priceCheckIntervalSec * 1000);
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
