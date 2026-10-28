/** Seeded random (the DOM VIRUS core LCG, same sequence). Use it for anything that changes the
 *  simulation, so a run can be replayed or synced; `state` reads and restores it for snapshots.
 *  The state lives in a Uint32Array so drawing a number never allocates. */
export interface Random {
  (): number;
  state: number;
}
export function seeded(seed = 1): Random {
  const s = new Uint32Array(1);
  s[0] = seed;
  const r = (() => ((s[0] = Math.imul(s[0]!, 1664525) + 1013904223), s[0]! / 4294967296)) as Random;
  Object.defineProperty(r, "state", { get: () => s[0], set: (v: number) => (s[0] = v) });
  return r;
}
