# Solana copy-trading bot

Bot sleduje peněženky vybraných traderů na Solaně (přímo z blockchainu, bez Fomo API) a kopíruje jejich nákupy a prodeje.
**Stav: všechny 4 fáze hotové. Live mód je zatím netestovaný na reálné síti – začni testovacím obchodem.**

## 1. Příprava (jednou)

1. **Node.js** (verze 20 nebo novější): v terminálu napiš `node -v`. Když vypíše číslo `v20…` nebo vyšší, máš ho. Jinak ho stáhni z https://nodejs.org (tlačítko LTS) a nainstaluj.
2. **Helius účet** (zdarma): na https://helius.dev se zaregistruj, v dashboardu zkopíruj **API key**.
3. V složce projektu spusť `npm install`.
4. Zkopíruj `.env.example` na `.env` (`cp .env.example .env`) a do `.env` doplň:
   - `HELIUS_API_KEY=` tvůj klíč,
   - `TRADERS=` adresy traderů ve tvaru `jmeno:adresa,jmeno2:adresa2`.
   Adresu peněženky tradera zjistíš na jeho profilu ve Fomo (je to jeho Solana adresa) nebo ji najdeš na solscan.io.

## 2. Jen sledování (fáze 2)

```
npm run watch
```
Bot vypisuje „Trader X KOUPIL/PRODAL token Y za Z SOL“ a odkaz na Solscan. Nic nekupuje. Porovnej výpis s tím, co vidíš ve Fomo appce (částka SOL a token by měly sedět).

## 3. Paper trading (fáze 3)

```
npm start        # MODE=paper je výchozí, nic se neposílá
npm run report   # souhrn: obchody, win rate, zisk/ztráta, výsledky podle tradera
```
Ceny bere z Jupiter quote. Pozice se ukládají do `positions.json` (přežijí restart), každý signál, obchod i přeskočení (s důvodem) do `trades.jsonl`. Nech to běžet aspoň týden.

Testy (bez internetu): `npm test`.

## Volby v `.env`

| Volba | Co dělá |
|---|---|
| `MODE` | `paper` = simulace (výchozí), `live` = skutečné obchody (fáze 4) |
| `HELIUS_API_KEY` | klíč z helius.dev; z něj se složí RPC i WebSocket adresa |
| `RPC_URL`, `WS_URL` | volitelně vlastní adresy místo Helius klíče |
| `TRADERS` | `jmeno:adresa,jmeno:adresa` |
| `BUY_AMOUNT_SOL` | kolik SOL utratíme za jeden nákup |
| `MIN_TRADER_BUY_SOL` | ignoruj nákupy tradera menší než X SOL (0.5) |
| `MAX_OPEN_POSITIONS` | max. počet otevřených pozic (5) |
| `MAX_TOTAL_SOL_AT_RISK` | když by součet otevřených pozic překročil limit, nekupuj |
| `MAX_PRICE_DRIFT_PCT` | nekupuj, když je naše cena o víc než X % horší než traderova (25) |
| `SLIPPAGE_BPS` | povolený prokluz, 100 = 1 % |
| `PRIORITY_FEE_LAMPORTS` | priority fee (použije se až ve fázi 4) |
| `JUPITER_URL`, `JUPITER_API_KEY` | adresa Jupiter API (výchozí `https://lite-api.jup.ag`), volitelný klíč |
| `MIRROR_SELLS` | když trader prodá X %, prodáme X % naší pozice |
| `TAKE_PROFIT_PCT` / `STOP_LOSS_PCT` | prodej všeho při zisku / ztrátě o tolik % (100 / 40) |
| `PRICE_CHECK_INTERVAL_SEC` | jak často kontrolovat ceny pozic |
| `POSITIONS_FILE`, `TRADES_FILE` | názvy souborů s pozicemi a logem |
| `PRIVATE_KEY` | jen fáze 4, vždy nová samostatná peněženka s malou částkou |

## Jak to funguje

- Sledování: `connection.onLogs` přes WebSocket (`confirmed`), deduplikace podle signature, kontrola zdraví RPC každých 30 s (`@solana/web3.js` se po výpadku WebSocketu připojí a obnoví odběry sám).
- Rozpoznání swapu: porovnání zůstatků peněženky před/po transakci (SOL + WSOL + tokeny), žádné dekódování DEXů. Ignoruje se změna SOL pod 0.001, neúspěšné transakce a token-za-token swapy.

## 4. Live (jen po týdnu úspěšného paper tradingu!)

1. **Vytvoř novou peněženku jen pro bota** (např. Phantom → nový účet) a pošli tam malou částku (např. 0.3 SOL). Nikdy nepoužívej svou hlavní peněženku.
2. Exportuj její privátní klíč a vlož ho do `.env` jako `PRIVATE_KEY=` (base58 řetězec z Phantomu). Nikomu ho neposílej.
3. Nastav `MODE=live` a **jeden testovací obchod**:
   ```
   npm run test-trade -- <adresa tokenu>   # koupí za 0.005 SOL a hned prodá
   ```
   Po 10 s odpočtu pošle skutečné transakce. Zkontroluj výsledek na Solscan. Doporučený token pro test: nějaký likvidní, ne čerstvý memecoin.
4. Když test dopadne dobře, spusť `npm start`. Bot vypíše velké varování a 10 s čeká (Ctrl+C zruší).

V live módu bot před nákupem zkontroluje zůstatek SOL, při prodeji prodává jen to, co v peněžence opravdu je, a skutečné částky bere z potvrzené transakce. Privátní klíč se nikdy nevypisuje.

## Poznámky

- Jupiter endpointy (`/swap/v1/quote`, `/swap/v1/swap` na `lite-api.jup.ag`) jsem **nemohl ověřit proti živému API** (sandbox blokuje jup.ag). Kód odpovídá dokumentaci podle mé znalosti; při chybě zkontroluj https://dev.jup.ag/docs.
- Nic nebylo testováno proti reálné síti, jen jednotkové testy se syntetickými transakcemi.
- Rizika: memecoiny mohou jít na nulu nebo jít nejde prodat (honeypot). Používej jen částky, o které se nebojíš přijít.
