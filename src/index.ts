import { loadConfig, loadWatchConfig } from "./config.js";
import { initLogger, say } from "./logger.js";
import { startWatcher } from "./watcher.js";
import { PositionStore } from "./positions.js";
import { Engine } from "./engine.js";
import { LiveExecutor, PaperExecutor } from "./executor.js";

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

  if (cmd !== "run") throw new Error(`Neznámý příkaz "${cmd}". Použij: watch | run`);

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
