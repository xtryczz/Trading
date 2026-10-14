import type { Config } from "./config.js";
import { WSOL } from "./swapDetect.js";

export interface Quote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  slippageBps: number;
  priceImpactPct?: string;
  [k: string]: unknown;
}

function headers(cfg: Config): Record<string, string> {
  return cfg.jupiterApiKey ? { "x-api-key": cfg.jupiterApiKey } : {};
}

/** GET {JUPITER_URL}/swap/v1/quote */
export async function getQuote(
  cfg: Config,
  inputMint: string,
  outputMint: string,
  amountRaw: bigint,
): Promise<Quote> {
  const url =
    `${cfg.jupiterUrl}/swap/v1/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amountRaw}&slippageBps=${cfg.slippageBps}&restrictIntermediateTokens=true`;
  const res = await fetch(url, { headers: headers(cfg) });
  if (!res.ok) throw new Error(`Jupiter quote ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as Quote;
}

/** Cena nákupu: kolik tokenů dostaneme za solAmount SOL. */
export async function quoteBuy(cfg: Config, mint: string, decimals: number, solAmount: number) {
  const lamports = BigInt(Math.round(solAmount * 1e9));
  const quote = await getQuote(cfg, WSOL, mint, lamports);
  const tokens = Number(quote.outAmount) / 10 ** decimals;
  if (!(tokens > 0)) throw new Error("Jupiter vrátil nulové množství tokenů");
  return { quote, tokens, priceSol: solAmount / tokens };
}

/** Cena prodeje: kolik SOL dostaneme za `tokens` tokenů. */
export async function quoteSell(cfg: Config, mint: string, decimals: number, tokens: number) {
  const raw = BigInt(Math.floor(tokens * 10 ** decimals));
  if (raw <= 0n) throw new Error("Nulové množství k prodeji");
  const quote = await getQuote(cfg, mint, WSOL, raw);
  return { quote, solOut: Number(quote.outAmount) / 1e9 };
}
