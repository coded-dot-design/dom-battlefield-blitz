const KIND = ["finite number", "number > 0", "positive integer"];
/** Options are checked once, at setup, so a bad number fails here with its name instead of as NaN
 *  mid-game. Kind: 0 any finite number, 1 a finite number > 0, 2 a positive integer (capacities). */
export function need(v: unknown, name: string, kind = 0): number {
  if (typeof v !== "number" || !isFinite(v) || (kind && v <= 0) || (kind > 1 && v % 1))
    throw new RangeError(`fizlet: ${name} must be a ${KIND[kind]} (got ${String(v)})`);
  return v;
}
