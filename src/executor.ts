import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Config } from "./config.js";
import { getQuote, quoteBuy, quoteSell, type Quote } from "./jupiter.js";
import { WSOL, detectSwap } from "./swapDetect.js";
import { say } from "./logger.js";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadKeypair(secret: string): Keypair {
  if (!secret) throw new Error("PRIVATE_KEY v .env je prázdný (potřebný pro MODE=live).");
  try {
    const bytes = secret.startsWith("[") ? Uint8Array.from(JSON.parse(secret)) : bs58.decode(secret);
    return Keypair.fromSecretKey(bytes);
  } catch {
    // Záměrně nevypisujeme obsah klíče.
    throw new Error("PRIVATE_KEY nemá platný formát (base58 nebo JSON pole).");
  }
}

/** Skutečné swapy přes Jupiter: quote -> /swap -> podpis -> odeslání -> potvrzení. */
export class LiveExecutor implements Executor {
  private connection: Connection;
  private wallet: Keypair;
  constructor(private cfg: Config) {
    this.wallet = loadKeypair(cfg.privateKey);
    this.connection = new Connection(cfg.rpcUrl, { commitment: "confirmed" });
    say(`🔑 Peněženka bota: ${this.wallet.publicKey.toBase58()}`);
  }

  async preview(mint: string, decimals: number, solAmount: number) {
    const q = await quoteBuy(this.cfg, mint, decimals, solAmount);
    return { tokens: q.tokens, priceSol: q.priceSol };
  }
  async value(mint: string, decimals: number, tokens: number) {
    return (await quoteSell(this.cfg, mint, decimals, tokens)).solOut;
  }

  /** Kolik tokenů mint skutečně držíme (v ui jednotkách). */
  async tokenBalance(mint: string): Promise<number> {
    const r = await this.connection.getParsedTokenAccountsByOwner(this.wallet.publicKey, { mint: new PublicKey(mint) });
    return r.value.reduce((s, a) => s + Number(a.account.data.parsed.info.tokenAmount.uiAmountString ?? 0), 0);
  }

  async buy(mint: string, decimals: number, solAmount: number): Promise<BuyResult> {
    const lamports = await this.connection.getBalance(this.wallet.publicKey);
    const need = solAmount + 0.01; // rezerva na poplatky a rent
    if (lamports / 1e9 < need) throw new Error(`Málo SOL v peněžence (${(lamports / 1e9).toFixed(4)}, potřeba ~${need.toFixed(3)})`);
    const quote = await getQuote(this.cfg, WSOL, mint, BigInt(Math.round(solAmount * 1e9)));
    const { signature, tokenDelta, solDelta } = await this.swap(quote);
    const est = Number(quote.outAmount) / 10 ** decimals;
    const tokens = tokenDelta ?? est;
    const spent = solDelta ?? solAmount;
    return { tokens, solSpent: spent, priceSol: spent / tokens, txSignature: signature };
  }

  async sell(mint: string, decimals: number, tokens: number): Promise<SellResult> {
    const have = await this.tokenBalance(mint);
    if (have <= 0) throw new Error("V peněžence už token nemáme");
    const amount = Math.min(tokens, have);
    const raw = BigInt(Math.floor(amount * 10 ** decimals));
    const quote = await getQuote(this.cfg, mint, WSOL, raw);
    const { signature, solDelta } = await this.swap(quote);
    return { solReceived: solDelta ?? Number(quote.outAmount) / 1e9, txSignature: signature };
  }

  /** Vyžádá swap transakci od Jupiteru, podepíše, pošle a počká na potvrzení. */
  private async swap(quote: Quote) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.cfg.jupiterApiKey) headers["x-api-key"] = this.cfg.jupiterApiKey;
    const res = await fetch(`${this.cfg.jupiterUrl}/swap/v1/swap`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: this.wallet.publicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: this.cfg.priorityFeeLamports,
      }),
    });
    if (!res.ok) throw new Error(`Jupiter swap ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const { swapTransaction, lastValidBlockHeight } = (await res.json()) as { swapTransaction: string; lastValidBlockHeight?: number };

    const tx = VersionedTransaction.deserialize(Buffer.from(swapTransaction, "base64"));
    tx.sign([this.wallet]);
    const signature = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    say(`📤 Odesláno: https://solscan.io/tx/${signature}`);

    // Čekáme na potvrzení (max ~60 s)
    const deadline = Date.now() + 60_000;
    for (;;) {
      const st = (await this.connection.getSignatureStatuses([signature])).value[0];
      if (st?.err) throw new Error(`Transakce selhala on-chain: ${JSON.stringify(st.err)}`);
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) break;
      if (Date.now() > deadline) throw new Error(`Transakce ${signature} nebyla do 60 s potvrzena (zkontroluj na Solscan!)`);
      await sleep(1500);
    }

    // Skutečné částky zjistíme ze zůstatků naší peněženky.
    let tokenDelta: number | undefined;
    let solDelta: number | undefined;
    try {
      const parsed = await this.connection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
      const d = parsed && detectSwap(parsed, this.wallet.publicKey.toBase58(), signature);
      if (d) {
        tokenDelta = d.tokenAmount;
        solDelta = d.solAmount;
      }
    } catch {
      /* použijeme odhad z quote */
    }
    return { signature, tokenDelta, solDelta };
  }
}

/** Zjistí decimals tokenu z blockchainu (pro testovací obchod). */
export async function fetchDecimals(rpcUrl: string, mint: string): Promise<number> {
  const info = await new Connection(rpcUrl).getParsedAccountInfo(new PublicKey(mint));
  const data: any = info.value?.data;
  if (!data?.parsed) throw new Error("Neplatná adresa tokenu (mint).");
  return data.parsed.info.decimals;
}
