/**
 * fizlet/fx: explosions that land. One fixed pool of particles (struct-of-arrays, no allocation),
 * drawn on a canvas: square debris, flashes, shock rings, spinning square rings, smoke, scorch marks
 * and pop words, plus screen shake. `blast()` is the DOM VIRUS / Battlefield hero recipe.
 * Gravity (`gravity`, px/s²) pulls each kind by its own share. Particle kinds are data (shape, drag,
 * gravity, how they leave an emitter): `emitter(fx, KINDS)` registers the built-in bubble, spark,
 * drip and debris (or your own) and sprays them; a page that never calls it never ships it. Visual only: its own random (seeded from Math.random), never the
 * simulation's seeded random.
 */
const TAU = Math.PI * 2;
const DEBRIS = 0, DISC = 1, RING = 2, SQUARE = 3, WORD = 4, SMOKE = 5, STREAK = 6;
/** Shapes a kind can draw as (a streak trails its velocity: sparks, drips). */
export const SHAPES = ["square", "disc", "ring", "frame", "word", "smoke", "streak"] as const;

/** A particle kind, as data. Ranges are [min, max]; speed and size scale with emit's `scale`. */
export interface Kind {
  shape: (typeof SHAPES)[number];
  /** Velocity lost per second, as a fraction (1.4 is the blast's smoke and flashes). */
  drag: number;
  /** Share of the pool's gravity (0: none; negative floats up, like a bubble). */
  gravity: number;
  /** Emit direction in radians (-π/2 is up) and the spread around it (2π: all round). */
  angle: number;
  spread: number;
  speed: readonly [number, number];
  size: readonly [number, number];
  life: readonly [number, number];
}
// The built-in kinds, one const each so a page that takes one ships only that one. Angles are
// literals (not Math.PI) so these stay pure and tree-shake.
/** Built-in particle kind: small squares that drift up and fade. */
export const BUBBLE: Kind = { shape: "square", drag: 1.4, gravity: -0.3, angle: -1.5708, spread: 0.7, speed: [25, 75], size: [1, 1.5], life: [0.7, 1.6] };
/** Built-in particle kind: fast streaks thrown in every direction, falling a little. */
export const SPARK: Kind = { shape: "streak", drag: 3, gravity: 0.6, angle: 0, spread: 6.2832, speed: [160, 420], size: [1, 2], life: [0.2, 0.5] };
/** Built-in particle kind: streaks that fall straight down. */
export const DRIP: Kind = { shape: "streak", drag: 0, gravity: 1, angle: 1.5708, spread: 0.2, speed: [0, 20], size: [1, 2], life: [0.6, 1.2] };
/** Built-in particle kind: square debris thrown in every direction, falling under full gravity. */
export const DEBRIS_KIND: Kind = { shape: "square", drag: 2.6, gravity: 1, angle: 0, spread: 6.2832, speed: [120, 300], size: [4, 9], life: [0.5, 0.9] };
/** All four by name: `emitter(fx, KINDS)`, or pick some (`emitter(fx, { bubble: BUBBLE })`). */
export const KINDS = { bubble: BUBBLE, spark: SPARK, drip: DRIP, debris: DEBRIS_KIND };
// blast()'s five hero parts: flash, fireball, core, shock ring, spinning square ring.
const HERO_KIND = [DISC, DISC, DISC, RING, SQUARE], HERO_SIZE = [26, 20, 14, 18, 24], HERO_LIFE = [0.28, 0.5, 0.42, 0.5, 0.6], HERO_COL = [0, 1, 2, 0, 3];

/** Options for `effects()`: the particle cap, the colour and word tables, scorch marks and gravity. */
export interface FxOptions {
  /** Max live particles (default 420). New ones are refused (and counted in `dropped`) when full. */
  cap?: number;
  /** Colour table, at most 256; particles store an index (default: the Battlefield blast palette). */
  colors?: string[];
  /** Word table for pop words (index into it), at most 256. */
  words?: string[];
  /** Max scorch marks kept on the ground (default 36; 0 turns them off). */
  scorch?: number;
  /** Gravity in px/s² down (default 0); each kind takes its own share of it. */
  gravity?: number;
}

/** `v` is a finite number (NaN and ±Infinity fail). No allocation: safe in the hot path. */
const finite = (v: number) => v - v === 0;
function check(ok: boolean, what: string) {
  if (!ok) throw new RangeError(`effects: ${what}`);
}

/**
 * Overload policy: particles are decorative, so a full pool refuses new ones and counts them in
 * `dropped`; a blast stops its per-particle work as soon as the pool is full. Invalid input
 * (non-finite numbers, a life that would never end) is refused and counted the same way.
 */
export function effects(o: FxOptions = {}) {
  const cap = o.cap ?? 420;
  const colors = o.colors ?? ["#fff4ff", "#ffc21a", "#ff8a1f", "#ff2e88", "#19f0ff", "#39ffb0", "#9a63ff", "#07060f"];
  const words = o.words ?? ["BOOM", "KABOOM", "WRECKED", "DIRECT HIT", "BLAM"];
  const sc = o.scorch ?? 36;
  check(Number.isInteger(cap) && cap > 0, "cap");
  check(Number.isInteger(sc) && sc >= 0, "scorch");
  check(colors.length <= 256 && words.length <= 256, "256 colors, words");
  // x, y, vx, vy, rot, spin, size, life, max: one Float32Array per field.
  const f = Array.from({ length: 9 }, () => new Float32Array(cap));
  const [X, Y, VX, VY, ROT, SPIN, SIZE, LIFE, MAX] = f as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  const kind = new Uint8Array(cap), col = new Uint8Array(cap), word = new Uint8Array(cap);
  const SX = new Float32Array(sc), SY = new Float32Array(sc), SR = new Float32Array(sc), SL = new Float32Array(sc);
  const U = new Float64Array(6);
  const st = new Float64Array(5); // live count, next scorch, shake, dropped, gravity
  // The kind table: one row of numbers per kind (shape, drag, gravity share, then emitter() ranges),
  // read by id in the hot path. Ids 0-5 are the blast's own parts (its debris falls); emitter() adds 6+.
  const K = new Float32Array(32 * 11);
  for (let i = 0; i < 6; i++) (K[i * 11] = i), (K[i * 11 + 1] = i ? 1.4 : 2.6);
  K[2] = 1;

  function spawn(k: number, x: number, y: number, vx: number, vy: number, size: number, life: number, c: number, rot = 0, spin = 0, w = 0) {
    const i = st[0]!;
    if (i >= cap || !(finite(x) && finite(y) && finite(vx) && finite(vy) && finite(size) && life > 0 && life < Infinity)) return st[3]!++, false;
    st[0] = i + 1;
    kind[i] = k;
    X[i] = x;
    Y[i] = y;
    VX[i] = vx;
    VY[i] = vy;
    SIZE[i] = size;
    LIFE[i] = MAX[i] = life;
    col[i] = c;
    ROT[i] = rot;
    SPIN[i] = spin;
    word[i] = w;
    return true;
  }
  // Visual randomness: a private LCG seeded from Math.random, never the simulation's seeded random.
  // (Math.random returns a fresh heap number per call, even in optimized code; this never allocates.)
  const seed = new Uint32Array([Math.random() * 4294967296]);
  const rnd = (a: number, b: number) => {
    seed[0] = Math.imul(seed[0]!, 1664525) + 1013904223;
    return a + (seed[0]! / 4294967296) * (b - a);
  };

  const fx = {
    colors,
    words,
    spawn,
    get live() {
      return st[0]!;
    },
    get shake() {
      return st[2]!;
    },
    /** Particles refused so far: pool full, or invalid input. Decorative, so they may drop; counted. */
    get dropped() {
      return st[3]!;
    },
    /** Set gravity in px/s² down (each kind takes its own share; read it back from your own state). */
    set gravity(g: number) {
      if (finite(g)) st[4] = g;
    },
    /** The pool itself, for emitter() and other helpers in this file. Not public API. */
    raw: { f, kind, col, word, st, K, cap, rnd },
    /** Add screen shake (decays on its own; read `shake` when drawing). */
    kick(amount: number) {
      if (finite(amount)) st[2] = Math.min(18, Math.max(0, st[2]! + amount));
    },
    /** Pop word (index into `words`), drifting up. */
    word(x: number, y: number, w: number, c: number, size = 16) {
      spawn(WORD, x, y, rnd(-14, 14), -70, size, 0.9, c, rnd(-0.18, 0.18), 0, w);
    },
    /** The hero explosion: flash, fireball, shock ring, spinning square ring, debris, smoke, scorch. */
    blast(x: number, y: number, power = 1, tint = 3) {
      if (!(finite(x) && finite(y) && finite(power) && power >= 0)) return void st[3]!++;
      // One loop writes the typed arrays directly (no per-particle call taking numbers, so nothing
      // boxes): 5 hero parts, n debris, 4 smoke. Bounded work: it stops at capacity and counts the rest.
      const k = power, n = Math.round(10 + power * 5), all = n + 9;
      for (let i = 0; i < all; i++) {
        const p = st[0]!;
        if (p >= cap) {
          st[3] = st[3]! + all - i;
          break;
        }
        st[0] = p + 1;
        // Six uniform draws per particle from one call site (one inlined rnd: nothing boxes).
        for (let r = 0; r < 6; r++) U[r] = rnd(0, 1);
        X[p] = x;
        Y[p] = y;
        VX[p] = VY[p] = ROT[p] = SPIN[p] = 0;
        word[p] = 0;
        if (i < 5) {
          // Flash, fireball, core, shock ring, spinning square ring.
          kind[p] = HERO_KIND[i]!;
          SIZE[p] = HERO_SIZE[i]! * k;
          LIFE[p] = MAX[p] = HERO_LIFE[i]!;
          col[p] = i === 3 ? tint : HERO_COL[i]!;
          if (i === 2) (X[p] += U[0]! * 12 - 6), (Y[p] += U[1]! * 12 - 6);
          if (i === 4) (ROT[p] = 0.3), (SPIN[p] = 1.6);
        } else if (i < n + 5) {
          const d = i - 5, a = (d / n) * TAU + U[0]! * 0.4 - 0.2, sp = (120 + U[1]! * 180) * k;
          kind[p] = DEBRIS;
          VX[p] = Math.cos(a) * sp;
          VY[p] = Math.sin(a) * sp;
          SIZE[p] = (4 + U[2]! * 5) * k;
          LIFE[p] = MAX[p] = 0.5 + U[3]! * 0.4;
          col[p] = d % 5 === 0 ? tint : d % 5;
          ROT[p] = U[4]! * TAU;
          SPIN[p] = U[5]! * 18 - 9;
        } else {
          kind[p] = SMOKE;
          X[p] += U[0]! * 20 - 10;
          Y[p] += U[1]! * 20 - 10;
          VX[p] = U[2]! * 40 - 20;
          VY[p] = U[3]! * 22 - 30;
          SIZE[p] = (12 + U[4]! * 8) * k;
          LIFE[p] = MAX[p] = 0.8 + U[5]! * 0.5;
          col[p] = 6;
        }
      }
      if (sc) {
        const s = st[1]! % sc;
        SX[s] = x;
        SY[s] = y;
        SR[s] = 16 * k;
        SL[s] = 9;
        st[1] = st[1]! + 1;
      }
      st[2] = Math.min(18, st[2]! + power * 3.5);
    },
    /** Advance every particle (call once per frame or per step). */
    step(dt: number) {
      let n = st[0]!;
      for (let i = n - 1; i >= 0; i--) {
        LIFE[i]! -= dt;
        if (LIFE[i]! <= 0) {
          n--;
          if (i !== n) for (const a of f) a[i] = a[n]!;
          kind[i] = kind[n]!;
          col[i] = col[n]!;
          word[i] = word[n]!;
          continue;
        }
        const r = kind[i]! * 11, drag = K[r + 1]!;
        VY[i]! += st[4]! * K[r + 2]! * dt;
        X[i]! += VX[i]! * dt;
        Y[i]! += VY[i]! * dt;
        VX[i]! -= VX[i]! * drag * dt;
        VY[i]! -= VY[i]! * drag * dt;
        ROT[i]! += SPIN[i]! * dt;
      }
      st[0] = n;
      for (let i = 0; i < sc; i++) if (SL[i]! > 0) SL[i]! -= dt;
      st[2] = Math.max(0, st[2]! - dt * 40);
    },
    /** Scorch marks under everything; call before drawing the actors. */
    drawGround(ctx: CanvasRenderingContext2D, light = false) {
      ctx.fillStyle = light ? "#1b1636" : "#000";
      for (let i = 0; i < sc; i++) {
        if (SL[i]! <= 0) continue;
        ctx.globalAlpha = Math.min(1, SL[i]! / 3) * (light ? 0.16 : 0.5);
        ctx.beginPath();
        ctx.arc(SX[i]!, SY[i]!, SR[i]!, 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },
    /** Every live particle, on top of the actors. */
    draw(ctx: CanvasRenderingContext2D, light = false) {
      const n = st[0]!;
      for (let i = 0; i < n; i++) {
        const k = LIFE[i]! / MAX[i]!, c = colors[col[i]!]!, s = SIZE[i]!, sh = K[kind[i]! * 11], a = ROT[i]!;
        let x = X[i]!, y = Y[i]!;
        // A turned particle draws about its own origin (one save/restore, only when it is turned).
        if (a) ctx.save(), ctx.translate(x, y), ctx.rotate(a), (x = y = 0);
        switch (sh) {
          case STREAK: {
            // A streak stretches with its speed (falling drips, sparks), square to the page.
            const l = Math.abs(VY[i]!) * 0.03 + s;
            ctx.globalAlpha = Math.min(1, k * 2);
            ctx.fillStyle = c;
            ctx.fillRect(x - s / 2, y - l, s, l);
            break;
          }
          case DEBRIS:
            ctx.globalAlpha = Math.min(1, k * 1.6);
            ctx.fillStyle = c;
            ctx.fillRect(x - s / 2, y - s / 2, s, s);
            break;
          case DISC:
          case SMOKE: {
            const smoke = sh === SMOKE;
            ctx.globalAlpha = smoke ? k * (light ? 0.12 : 0.2) : k;
            ctx.fillStyle = smoke ? (light ? "#5d5684" : "#2a2150") : c;
            ctx.beginPath();
            ctx.arc(x, y, s * (smoke ? 1.4 - k * 0.6 : 0.6 + (1 - k) * 1.6), 0, TAU);
            ctx.fill();
            break;
          }
          case RING:
          case SQUARE: {
            ctx.globalAlpha = k;
            ctx.strokeStyle = c;
            ctx.lineWidth = 4 * k + 1;
            const r = s * (0.5 + (1 - k) * (sh === RING ? 4.2 : 3));
            if (sh === RING) {
              ctx.beginPath();
              ctx.arc(x, y, r, 0, TAU);
              ctx.stroke();
            } else ctx.strokeRect(x - r / 2, y - r / 2, r, r);
            break;
          }
          case WORD:
            ctx.globalAlpha = Math.min(1, k * 2);
            ctx.font = `900 ${Math.round(s * (1 + (1 - k) * 0.3))}px ui-monospace, SFMono-Regular, monospace`;
            ctx.textAlign = "center";
            ctx.lineWidth = 5;
            ctx.strokeStyle = light ? "#fff" : "#07060f";
            ctx.strokeText(words[word[i]!]!, x, y);
            ctx.fillStyle = c;
            ctx.fillText(words[word[i]!]!, x, y);
        }
        if (a) ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
    clear() {
      st[0] = 0;
      SL.fill(0);
      st[2] = 0;
    },
  };
  fx.gravity = o.gravity ?? 0; // the setter ignores a non-finite value
  return fx;
}
/** The particle pool `effects()` returns. */
export type Effects = ReturnType<typeof effects>;

/**
 * Named particle kinds on a pool: `const { ids, emit } = emitter(fx, KINDS)`, then
 * `emit(ids.bubble, x, y, 12)`. Its own export, so a page that never sprays kinds never ships it.
 * At most 26 kinds per pool (ids 6-31); a second emitter on the same pool adds after the first.
 */
export function emitter<N extends string>(fx: Effects, kinds: Record<N, Kind>) {
  const { f, kind, col, word, st, K, cap, rnd } = fx.raw, U = new Float64Array(5);
  const [X, Y, VX, VY, ROT, SPIN, SIZE, LIFE, MAX] = f as Float32Array[] as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  const ids = {} as Record<N, number>;
  let nk = 6;
  while (nk < 32 && K[nk * 11 + 9]) nk++; // after kinds an earlier emitter added (each has a life > 0)
  for (const name in kinds) {
    const d = kinds[name], row = [SHAPES.indexOf(d.shape), d.drag, d.gravity, d.angle, d.spread, ...d.speed, ...d.size, ...d.life];
    check(nk < 32 && row[0]! >= 0 && row.every(finite) && row[9]! > 0 && row[10]! >= row[9]!, `kind ${name}`);
    K.set(row, nk * 11);
    ids[name] = nk++;
  }
  return {
    ids,
    /**
     * `n` particles of kind `k` from (x, y), as that kind's data says: direction, spread, speed, size
     * and life (speed and size times `scale`). Colours are picked from `c`...`c + cn - 1`. Bounded: it
     * stops at capacity and counts the rest in `dropped`. Writes the arrays directly: nothing boxes.
     */
    emit(k: number, x: number, y: number, n: number, c = 0, cn = 1, scale = 1) {
      if (!(k >= 6 && k < nk && finite(x) && finite(y) && finite(scale) && n < Infinity)) return void st[3]!++;
      const r = k * 11 + 1;
      for (let i = 0; i < n; i++) {
        const p = st[0]!;
        if (p >= cap) {
          st[3] = st[3]! + Math.ceil(n - i);
          break;
        }
        st[0] = p + 1;
        for (let q = 0; q < 5; q++) U[q] = rnd(0, 1);
        const a = K[r + 2]! + (U[0]! - 0.5) * K[r + 3]!, v = (K[r + 4]! + U[1]! * (K[r + 5]! - K[r + 4]!)) * scale;
        kind[p] = k;
        X[p] = x;
        Y[p] = y;
        VX[p] = Math.cos(a) * v;
        VY[p] = Math.sin(a) * v;
        SIZE[p] = (K[r + 6]! + U[2]! * (K[r + 7]! - K[r + 6]!)) * scale;
        LIFE[p] = MAX[p] = K[r + 8]! + U[3]! * (K[r + 9]! - K[r + 8]!);
        col[p] = c + ((U[4]! * cn) | 0);
        // Square to the page (pixel bubbles stay crisp): no rotation, no spin.
        ROT[p] = SPIN[p] = word[p] = 0;
      }
    },
  };
}
