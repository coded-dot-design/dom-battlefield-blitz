// Net play's seat map: who drives each tank (a human's lockstep slot, or the computer), its side and
// its place in that side. Every peer builds it from the same two things, so the roster is the same
// on every screen: the humans in the match (the room's WELCOME: P) and P1's mode bits, which ride in
// bits 9-11 and 13-15 of P1's input word through the countdown (presence agrees them on one frame).
// Bit 12 is the pause (every seat's, in play: src/game.ts), so the mode never uses it.
//   bits 9-11  0 = free-for-all, 1 = 1v1, 2-4 = kVk with AI wingmen (two humans); a 4-seat room the
//              computer backfills: 5 = FFA, 6 = 2v2 (7 reads as FFA)
//   bits 13-15 2v2: the side (0/1) of P2, P3, P4 (P1 leads side 0); at most 2 a side, else alternate
// Humans are tanks 0..P-1 in slot order, bots come after them. Bots run on the match's seeded random,
// like every other bot, so they are part of the lockstep match. Net builds only (src/net.ts).

export function seats(P: number, word: number, bots: number) {
  let k = (word >>> 9) & 7;
  const fill = k > 4;
  // Only the modes that exist: squads for two humans, FFA or 2v2 in a 4-seat room.
  k = fill ? (k === 6 ? 2 : 0) : P !== 2 ? 0 : k;
  const N = fill ? Math.max(P, 4) : k ? P * k : P + bots;
  const team: number[] = [], slot: number[] = [], size = [0, 0, 0, 0], lead = [-1, -1, -1, -1];
  // 2v2: the humans' sides as P1 sent them, unless a side would have three.
  let side = (word >>> 12) & 14;
  if (fill && k) for (let i = 0, n = 0; i < P; i++) if ((n += (side >>> i) & 1) > 2 || i + 1 - n > 2) side = 10; // P2, P4 on side 1
  for (let i = 0; i < N; i++) {
    const hu = i < P, w = i - P;
    // Squads (two humans): human i leads side i, wingmen fill sides in order. 2v2: the bot joins the
    // short side. FFA: every tank its own side.
    const t = !k ? i : fill ? (hu ? (side >>> i) & 1 : size[0]! < 2 ? 0 : 1) : hu ? i : (w / (k - 1)) | 0;
    team.push(t);
    slot.push(k ? size[t]!++ : 0);
    if (hu && lead[t]! < 0) lead[t] = i;
  }
  return { squad: k, fill, sides: fill && k ? 2 : P, team, slot, lead };
}
export type Seats = ReturnType<typeof seats>;
