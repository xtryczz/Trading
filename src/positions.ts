import { existsSync, readFileSync, writeFileSync } from "node:fs";

export interface Position {
  id: string;
  mint: string;
  decimals: number;
  tokens: number; // kolik tokenů držíme
  costSol: number; // kolik SOL stojí zbývající část pozice
  entryPriceSol: number;
  trader: string; // jméno tradera, kterého kopírujeme
  traderAddress: string;
  openedAt: string;
  mode: "paper" | "live";
}

export class PositionStore {
  private positions: Position[] = [];
  constructor(private file: string) {
    if (existsSync(file)) this.positions = JSON.parse(readFileSync(file, "utf8"));
  }
  all() {
    return this.positions;
  }
  get(mint: string) {
    return this.positions.find((p) => p.mint === mint);
  }
  totalCostSol() {
    return this.positions.reduce((s, p) => s + p.costSol, 0);
  }
  add(p: Position) {
    this.positions.push(p);
    this.save();
  }
  remove(mint: string) {
    this.positions = this.positions.filter((p) => p.mint !== mint);
    this.save();
  }
  save() {
    writeFileSync(this.file, JSON.stringify(this.positions, null, 2));
  }
}
