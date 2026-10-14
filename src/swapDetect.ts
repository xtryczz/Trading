import type { ParsedTransactionWithMeta } from "@solana/web3.js";

export const WSOL = "So11111111111111111111111111111111111111112";
const MIN_SOL_CHANGE = 0.001;
const LAMPORTS = 1e9;

export interface SwapSignal {
  kind: "buy" | "sell";
  trader: string; // adresa
  mint: string;
  decimals: number;
  solAmount: number; // kolik SOL trader utratil / získal (kladné)
  tokenAmount: number; // kolik tokenů koupil / prodal (kladné, v "ui" jednotkách)
  priceSol: number; // SOL za 1 token
  fractionSold?: number; // jen u prodeje, 0..1
  signature: string;
}

/**
 * Rozpozná swap porovnáním zůstatků peněženky před a po transakci.
 * Nedekóduje žádný konkrétní DEX. Vrací null, pokud to není jednoduchý SOL<->token swap.
 */
export function detectSwap(tx: ParsedTransactionWithMeta, wallet: string, signature: string): SwapSignal | null {
  const meta = tx.meta;
  if (!meta || meta.err) return null;

  const keys = tx.transaction.message.accountKeys;
  const idx = keys.findIndex((k) => k.pubkey.toBase58() === wallet);

  // Změna nativního SOL
  let solDelta = 0;
  if (idx !== -1) {
    let lamports = meta.postBalances[idx] - meta.preBalances[idx];
    if (idx === 0) lamports += meta.fee; // fee payer: přičti zpět poplatek
    solDelta = lamports / LAMPORTS;
  }

  // Změny tokenů pro majitele = wallet
  const pre = new Map<string, number>();
  const post = new Map<string, number>();
  const decimalsOf = new Map<string, number>();
  const add = (m: Map<string, number>, mint: string, v: number) => m.set(mint, (m.get(mint) ?? 0) + v);
  for (const b of meta.preTokenBalances ?? []) {
    if (b.owner !== wallet) continue;
    add(pre, b.mint, Number(b.uiTokenAmount.uiAmountString ?? b.uiTokenAmount.uiAmount ?? 0));
    decimalsOf.set(b.mint, b.uiTokenAmount.decimals);
  }
  for (const b of meta.postTokenBalances ?? []) {
    if (b.owner !== wallet) continue;
    add(post, b.mint, Number(b.uiTokenAmount.uiAmountString ?? b.uiTokenAmount.uiAmount ?? 0));
    decimalsOf.set(b.mint, b.uiTokenAmount.decimals);
  }

  const mints = new Set([...pre.keys(), ...post.keys()]);
  const changes: { mint: string; delta: number; before: number }[] = [];
  for (const mint of mints) {
    const before = pre.get(mint) ?? 0;
    const delta = (post.get(mint) ?? 0) - before;
    if (mint === WSOL) {
      solDelta += delta; // WSOL počítáme jako SOL
    } else if (delta !== 0) {
      changes.push({ mint, delta, before });
    }
  }

  if (Math.abs(solDelta) < MIN_SOL_CHANGE) return null; // rent / token-za-token
  if (changes.length === 0) return null;

  // Token s největší změnou
  changes.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const top = changes[0];

  let kind: "buy" | "sell";
  if (top.delta > 0 && solDelta < 0) kind = "buy";
  else if (top.delta < 0 && solDelta > 0) kind = "sell";
  else return null; // nesedí směr (např. token-za-token, převod)

  const tokenAmount = Math.abs(top.delta);
  const solAmount = Math.abs(solDelta);
  return {
    kind,
    trader: wallet,
    mint: top.mint,
    decimals: decimalsOf.get(top.mint) ?? 0,
    solAmount,
    tokenAmount,
    priceSol: solAmount / tokenAmount,
    fractionSold: kind === "sell" ? (top.before > 0 ? Math.min(1, tokenAmount / top.before) : 1) : undefined,
    signature,
  };
}
