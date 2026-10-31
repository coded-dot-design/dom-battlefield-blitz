// Blitz net play: two peers in lockstep over the in-memory link stay identical, frame for frame.
// Each peer has its own screen size and only its own player's input (a scripted stream of
// drives, shots, long shots, airstrikes and aim modes); the match must still be the same match.
// Run: node tests/lockstep.mjs (after npm run build).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = "https://blitz.test", FRAMES = Number(process.env.FRAMES ?? 3600);
const PAGE = `<!doctype html><meta charset="utf-8"><title>lockstep</title><style>body{margin:0}</style>
<div id="a" style="position:relative;width:1100px;height:640px"></div><div id="b" style="position:relative;width:700px;height:460px"></div>`;

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(`${ORIGIN}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return path === "/" ? route.fulfill({ contentType: "text/html", body: PAGE }) : route.fulfill({ contentType: "text/javascript", body: readFileSync(`dist${path}`) });
  });
  await page.goto(`${ORIGIN}/`);

  /** Two peers, `frames` lockstep frames, a digest of each world every 600 frames. */
  const run = (opts) =>
    page.evaluate(async ({ frames, latency, jitter, seed, scripted, squads, nets, n = 2, seconds = 600 }) => {
      const { createBlitz, memory } = await import("/blitz-net.mjs");
      // A screen per peer: a and b, then more for the 3- and 4-human modes.
      for (let i = 0; i < 4; i++) document.getElementById("abcd"[i])?.remove();
      for (let i = 0; i < n; i++) document.body.insertAdjacentHTML("beforeend", `<div id="${"abcd"[i]}" style="position:relative;width:${[1100, 700, 600, 390][i]}px;height:${[640, 460, 400, 300][i]}px"></div>`);
      const hub = memory({ peers: n, latency, jitter, seed: 5 });
      let calls = 0;
      const real = Math.random;
      // Scripted hands: each peer's own seeded stream (only that peer knows it).
      const hands = (slot) => {
        let s = 1000 + slot * 77;
        const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0), s / 4294967296);
        return () => {
          const mx = (r() * 3) | 0, my = (r() * 3) | 0, aim = (r() * 3) | 0;
          let b = mx | (my << 2) | (aim << 7);
          if (r() < 0.35) b |= 16;
          if (r() < 0.01) b |= 32;
          if (r() < 0.005) b |= 64;
          return (b | (((r() * 256) | 0) << 16) | (((r() * 256) | 0) << 24)) >>> 0;
        };
      };
      const ends = [];
      const peers = Array.from({ length: n }, (_, slot) =>
        createBlitz(document.getElementById("abcd"[slot]), { seed, seconds, bots: 4, onEnd: (st) => (ends[slot] = st), net: { transport: hub.ends[slot], slot, players: n, ...(scripted ? { input: hands(slot) } : {}), ...(squads ? { squad: squads[slot] } : {}), ...(nets ? nets[slot] : {}) } }),
      );
      for (const g of peers) g.engine.stop(); // step by hand: the shared clock must not add frames
      Math.random = () => (calls++, real());
      const digests = peers.map(() => []);
      const snap = (g) => {
        const w = g.world;
        return w.tanks.map((t) => [t.alive, Math.round(t.x * 100), Math.round(t.y * 100), Math.round(t.ta * 1000), t.hp, t.kills, t.deaths, t.rail, t.strikes].join(",")).join("|") + "#" + w.shells.filter((s) => s.on).length + "#" + g.hash();
      };
      let ticks = 0;
      while (peers.some((g) => g.net.frame < frames) && ticks < frames * 8) {
        hub.tick();
        ticks++;
        peers.forEach((g, i) => {
          if (g.net.frame >= frames) return;
          const before = g.net.frame;
          g.engine.advance(1 / 60);
          if (g.net.frame !== before && g.net.frame % 600 === 0) digests[i].push(snap(g));
        });
      }
      Math.random = real;
      const out = {
        frames: peers.map((g) => g.net.frame), stalls: peers.map((g) => g.net.stalls), desync: peers.map((g) => g.net.desync),
        digests, calls, final: peers.map((g) => g.hash()),
        kills: peers[0].world.tanks.reduce((a, t) => a + t.kills, 0), ends, states: peers.map((g) => g.state),
        // The result's table as each peer shows it (platoons: a side's kills and deaths, then you).
        tables: peers.map((_, i) => [...document.getElementById("abcd"[i]).shadowRoot.querySelectorAll(".table div")].map((d) => d.textContent)),
        teamKills: peers.map((g) => g.world.tanks.reduce((a, t) => ((a[t.team] = (a[t.team] ?? 0) + t.kills), a), [])),
        names: peers.map((g) => g.world.tanks.map((t) => t.name).join(" ")),
        squad: peers.map((g) => g.squad), rosters: peers.map((g) => g.world.tanks.map((t) => `${t.team}${t.you ? "H" : "A"}`).join(" ")),
        ready: peers.map((g) => g.world.tanks.filter((t) => t.alive || t.deaths > 0).length), humanShots: peers[0].world.tanks.slice(0, 2).map((t) => t.rail + "/" + t.strikes),
      };
      peers.forEach((g) => g.destroy());
      return out;
    }, opts);

  const fast = await run({ frames: FRAMES, latency: 0, jitter: 0, seed: 41, scripted: true });
  assert.deepEqual(fast.frames, [FRAMES, FRAMES]);
  assert.equal(fast.digests[0].length, FRAMES / 600);
  assert.deepEqual(fast.digests[0], fast.digests[1], "both peers: the same match every 600 frames");
  assert.equal(fast.final[0], fast.final[1], "the same state hash at the end");
  assert.deepEqual(fast.desync, [-1, -1], "no hash check ever differed");
  assert.equal(fast.calls, 0, "no Math.random in the match");
  assert.ok(fast.kills > 0, "tanks fought (the match isn't idle)");

  const slow = await run({ frames: FRAMES, latency: 6, jitter: 5, seed: 41, scripted: true });
  assert.deepEqual(slow.frames, [FRAMES, FRAMES]);
  assert.ok(slow.stalls[0] > 0 && slow.stalls[1] > 0, "a link slower than the input delay makes both wait");
  assert.deepEqual(slow.digests[0], slow.digests[1], "delayed, jittered, reordered inputs: still the same match");
  assert.deepEqual(slow.digests[0], fast.digests[0], "and the same match as with no latency at all");
  assert.deepEqual(slow.desync, [-1, -1]);

  // The real controls path (encode → word → human): no scripted input, keys held on the page.
  await page.keyboard.down("KeyD");
  const keys = await run({ frames: 900, latency: 2, jitter: 1, seed: 9, scripted: false });
  await page.keyboard.up("KeyD");
  assert.deepEqual(keys.frames, [900, 900]);
  assert.equal(keys.final[0], keys.final[1]);
  assert.deepEqual(keys.desync, [-1, -1]);

  // Team sizes (two players): P1's pick is the match's on both screens (P2 asked for another), the
  // humans lead sides 0 and 1, and each side gets squad - 1 AI wingmen. No desync.
  const sizes = [];
  for (const k of [1, 2, 3, 4]) {
    const t = await run({ frames: 900, latency: 2, jitter: 1, seed: 11 + k, scripted: true, squads: [k, (k % 4) + 1] });
    assert.deepEqual(t.frames, [900, 900]);
    assert.deepEqual(t.desync, [-1, -1], `${k}v${k}: no desync`);
    assert.equal(t.final[0], t.final[1], `${k}v${k}: the same match`);
    assert.deepEqual(t.squad, [k, k], `${k}v${k}: both peers play P1's pick`);
    const want = ["0H", "1H", ...Array.from({ length: 2 * (k - 1) }, (_, i) => `${(i / (k - 1)) | 0}A`)].join(" ");
    assert.equal(t.rosters[0], want, `${k}v${k}: ${2 * k} tanks, ${k} a side`);
    assert.equal(t.rosters[1], want);
    assert.equal(t.ready[0], 2 * k, `${k}v${k}: every tank dropped in`);
    sizes.push(`${k}v${k}`);
  }
  // No pick: free-for-all with the bots, as before.
  const ffa = await run({ frames: 300, latency: 0, jitter: 0, seed: 3, scripted: true, squads: [0, 3] });
  assert.deepEqual(ffa.squad, [0, 0]);
  assert.equal(ffa.rosters[0], "0H 1H 2A 3A 4A 5A", "free-for-all: 2 players + 4 bots, every tank its own side");

  // The four multiplayer modes (/play/multi/), 2 to 4 humans on the in-memory link. P1's pick is the
  // match's (the others ask for something else); every peer builds the same seat map; the computer
  // takes the seats no human took (at most 2); no desync; the same state hash after N frames.
  const MODES = [
    // [label, humans, P1's net options, the roster (team + Human/AI per tank)]
    ["1v1", 2, { squad: 1 }, "0H 1H"],
    ["4 seats, 2 humans + 2 bots (FFA)", 2, { fill: true }, "0H 1H 2A 3A"],
    ["4 seats, 3 humans + 1 bot (FFA)", 3, { fill: true }, "0H 1H 2H 3A"],
    ["4 seats, 4 humans (FFA)", 4, { fill: true }, "0H 1H 2H 3H"],
    ["2v2, 2 humans + an AI teammate each", 2, { fill: true, squad: 2 }, "0H 1H 0A 1A"],
    ["2v2, 3 humans + 1 bot", 3, { fill: true, squad: 2 }, "0H 1H 0H 1A"],
    ["2v2, 4 humans", 4, { fill: true, squad: 2 }, "0H 1H 0H 1H"],
    ["2v2, 4 humans, P1 + P2 vs P3 + P4 (P1's map)", 4, { fill: true, squad: 2, sides: 0b110 }, "0H 0H 1H 1H"],
    ["2v2, a map with 3 a side falls back to alternate", 4, { fill: true, squad: 2, sides: 0b111 }, "0H 1H 0H 1H"],
    ["1v1 platoons, 3 a side", 2, { squad: 3 }, "0H 1H 0A 0A 1A 1A"],
  ];
  const modes = [];
  for (const [label, n, mine, want] of MODES) {
    const others = { squad: 4 - (mine.squad ?? 0), fill: !mine.fill, sides: 0 };
    const t = await run({ frames: 900, latency: 2, jitter: 1, seed: 60 + modes.length, scripted: true, n, nets: Array.from({ length: n }, (_, i) => (i ? others : mine)) });
    assert.deepEqual(t.frames, Array(n).fill(900), `${label}: every peer ran 900 frames`);
    assert.deepEqual(t.desync, Array(n).fill(-1), `${label}: no desync`);
    assert.equal(new Set(t.final).size, 1, `${label}: the same state hash on all ${n} peers`);
    for (let i = 1; i < n; i++) assert.deepEqual(t.digests[i], t.digests[0], `${label}: P${i + 1} = P1 every 600 frames`);
    for (const r of t.rosters) assert.equal(r, want, `${label}: the seat map`);
    const bots = want.split(" ").filter((x) => x.endsWith("A")).length;
    if (mine.fill) assert.ok(bots <= 2 && want.split(" ").length === 4, `${label}: 4 seats, at most 2 bots`);
    assert.equal(t.ready[0], want.split(" ").length, `${label}: every seat's tank dropped in (bots too)`);
    modes.push(`${label} (${n} peers)`);
  }
  // 2v2 to the end (a 20 s match): each side's score is its tanks' kills, bots' too, on every screen,
  // and the side with more kills wins on every screen.
  const duel = await run({ frames: 60 * 26, latency: 1, jitter: 1, seed: 77, scripted: true, n: 3, seconds: 20, nets: [{ fill: true, squad: 2 }, {}, {}] });
  assert.equal(new Set(duel.final).size, 1, "2v2 to the end: the same match");
  assert.deepEqual(duel.states, ["end", "end", "end"], "2v2: the match ended");
  const [k0, k1] = [duel.teamKills[0][0] ?? 0, duel.teamKills[0][1] ?? 0];
  assert.ok(k0 + k1 > 0, "2v2: tanks fought");
  for (let i = 0; i < 3; i++) {
    const rows = duel.tables[i].filter((r) => /PLATOON/.test(r));
    assert.equal(rows.length, 2, `P${i + 1}: two sides on the result`);
    const mineSide = i === 1 ? 1 : 0, other = 1 - mineSide, kills = [k0, k1];
    const score = (r) => Number(/(\d+) K/.exec(r)[1]);
    const yours = rows.find((r) => /YOUR PLATOON/.test(r)), theirs = rows.find((r) => !/YOUR PLATOON/.test(r));
    assert.equal(score(yours), kills[mineSide], `P${i + 1}: your side's score = its tanks' kills`);
    assert.equal(score(theirs), kills[other], `P${i + 1}: their side's score = its tanks' kills`);
    assert.match(theirs, new RegExp(other === 1 ? "P2 PLATOON" : "P1 PLATOON"), `P${i + 1}: a side is named for its first human`);
    const top = kills[0] === kills[1] ? null : kills[0] > kills[1] ? 0 : 1;
    if (top !== null) assert.match(rows[0], top === mineSide ? /YOUR/ : /P\d PLATOON/, `P${i + 1}: the side with more kills is first`);
  }
  assert.deepEqual(duel.teamKills[0], duel.teamKills[2], "2v2: the same side scores on every screen");

  assert.deepEqual(errors, []);
  console.log(`Blitz modes: ${modes.join("; ")}: P1's pick on every screen, the right seat map, bots in empty seats, 0 desyncs, identical hashes. 2v2 to the end on 3 screens: side scores ${k0}–${k1} = its tanks' kills, on every result.`);
  console.log(
    `Blitz lockstep: 2 peers (1100×640 and 700×460 screens), ${FRAMES} frames identical every 600 frames and at the end; ` +
      `latency 6±5 ticks too (stalls ${slow.stalls.join("/")}), same match as no latency; ${fast.kills} kills; 0 desyncs; 0 Math.random in play; team sizes ${sizes.join(", ")} (P1's pick on both screens) and free-for-all spawn the right sides, 0 desyncs.`,
  );
} finally {
  await browser.close();
}
