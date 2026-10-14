import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { detectSwap, WSOL } from "../swapDetect.js";

const wallet = new PublicKey("11111111111111111111111111111112").toBase58();
const other = new PublicKey("SysvarRent111111111111111111111111111111111").toBase58();
const MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

const tb = (mint: string, amt: number, owner = wallet) => ({
  accountIndex: 5, mint, owner, programId: "x",
  uiTokenAmount: { amount: "0", decimals: 6, uiAmount: amt, uiAmountString: String(amt) },
});

function mk(opts: { idx: number; pre: number; post: number; fee?: number; preT?: any[]; postT?: any[]; err?: any }): any {
  const keys = [{ pubkey: new PublicKey(other) }, { pubkey: new PublicKey(other) }];
  keys[opts.idx] = { pubkey: new PublicKey(wallet) };
  const pre = [0, 0], post = [0, 0];
  pre[opts.idx] = opts.pre; post[opts.idx] = opts.post;
  return {
    transaction: { message: { accountKeys: keys } },
    meta: { err: opts.err ?? null, fee: opts.fee ?? 5000, preBalances: pre, postBalances: post, preTokenBalances: opts.preT ?? [], postTokenBalances: opts.postT ?? [] },
  };
}

// nákup: wallet je fee payer (idx 0), utratí 1 SOL + fee, dostane 1000 tokenů
let s = detectSwap(mk({ idx: 0, pre: 5e9, post: 4e9 - 5000, preT: [], postT: [tb(MINT, 1000)] }), wallet, "sig1")!;
assert.equal(s.kind, "buy"); assert.equal(s.mint, MINT);
assert.ok(Math.abs(s.solAmount - 1) < 1e-9, `solAmount ${s.solAmount}`);
assert.ok(Math.abs(s.priceSol - 0.001) < 1e-9);

// prodej 25 % pozice přes WSOL
s = detectSwap(mk({ idx: 1, pre: 1e9, post: 1e9, preT: [tb(MINT, 1000), tb(WSOL, 0)], postT: [tb(MINT, 750), tb(WSOL, 0.5)] }), wallet, "sig2")!;
assert.equal(s.kind, "sell"); assert.equal(s.fractionSold, 0.25); assert.ok(Math.abs(s.solAmount - 0.5) < 1e-9);

// drobná změna SOL (rent) se ignoruje
assert.equal(detectSwap(mk({ idx: 1, pre: 1e9, post: 1e9 - 500_000, postT: [tb(MINT, 5)] }), wallet, "s3"), null);
// neúspěšná tx
assert.equal(detectSwap(mk({ idx: 1, pre: 2e9, post: 1e9, postT: [tb(MINT, 5)], err: {} }), wallet, "s4"), null);
// token-za-token (SOL se nezměnil)
assert.equal(detectSwap(mk({ idx: 1, pre: 1e9, post: 1e9, preT: [tb(MINT, 10)], postT: [tb(MINT, 0), tb("So1", 5)] }), wallet, "s5"), null);
// token cizí peněženky se nepočítá
assert.equal(detectSwap(mk({ idx: 1, pre: 2e9, post: 1e9, postT: [tb(MINT, 5, other)] }), wallet, "s6"), null);

console.log("✅ swapDetect: všechny testy prošly");
