/**
 * fizlet/fx: explosions that land. One fixed pool of particles (struct-of-arrays, no allocation),
 * drawn on a canvas: square debris, flashes, shock rings, spinning square rings, smoke, scorch marks
 * and pop words, plus screen shake. `blast()` is the DOM VIRUS / Battlefield hero recipe.
 * Visual only: it uses Math.random, never the simulation's seeded random.
 */
const DEBRIS = 0, DISC = 1, RING = 2, SQUARE = 3, WORD = 4, SMOKE = 5;
const TAU = Math.PI * 2;

export interface FxOptions {
  /** Max live particles (default 420). New ones are refused when full. */
  cap?: number;
  /** Colour table; particles store an index (default: the Battlefield blast palette). */
  colors?: string[];
  /** Word table for pop words (index into it). */
  words?: string[];
  /** Max scorch marks kept on the ground (default 36). */
  scorch?: number;
}

export function effects(o: FxOptions = {}) {
  const cap = o.cap ?? 420;
  const colors = o.colors ?? ["#fff4ff", "#ffc21a", "#ff8a1f", "#ff2e88", "#19f0ff", "#39ffb0", "#9a63ff", "#07060f"];
  const words = o.words ?? ["BOOM", "KABOOM", "WRECKED", "DIRECT HIT", "BLAM"];
  // x, y, vx, vy, rot, spin, size, life, max: one Float32Array per field.
  const f = Array.from({ length: 9 }, () => new Float32Array(cap));
  const [X, Y, VX, VY, ROT, SPIN, SIZE, LIFE, MAX] = f as [Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array, Float32Array];
  const kind = new Uint8Array(cap), col = new Uint8Array(cap), word = new Uint8Array(cap);
  const sc = o.scorch ?? 36, SX = new Float32Array(sc), SY = new Float32Array(sc), SR = new Float32Array(sc), SL = new Float32Array(sc);
  const st = new Float64Array(4); // live count, next scorch, shake, light theme flag

  function spawn(k: number, x: number, y: number, vx: number, vy: number, size: number, life: number, c: number, rot = 0, spin = 0, w = 0) {
    const i = st[0]!;
    if (i >= cap) return false;
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
  const rnd = (a: number, b: number) => a + Math.random() * (b - a);

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
    /** Add screen shake (decays on its own; read `shake` when drawing). */
    kick(amount: number) {
      st[2] = Math.min(18, st[2]! + amount);
    },
    /** Pop word (index into `words`), drifting up. */
    word(x: number, y: number, w: number, c: number, size = 16) {
      spawn(WORD, x, y, rnd(-14, 14), -70, size, 0.9, c, rnd(-0.18, 0.18), 0, w);
    },
    /** The hero explosion: flash, fireball, shock ring, spinning square ring, debris, smoke, scorch. */
    blast(x: number, y: number, power = 1, tint = 3) {
      const k = power;
      spawn(DISC, x, y, 0, 0, 26 * k, 0.28, 0);
      spawn(DISC, x, y, 0, 0, 20 * k, 0.5, 1);
      spawn(DISC, x + rnd(-6, 6), y + rnd(-6, 6), 0, 0, 14 * k, 0.42, 2);
      spawn(RING, x, y, 0, 0, 18 * k, 0.5, tint);
      spawn(SQUARE, x, y, 0, 0, 24 * k, 0.6, 3, 0.3, 1.6);
      const n = Math.round(10 + power * 5);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + rnd(-0.2, 0.2), sp = rnd(120, 300) * k;
        spawn(DEBRIS, x, y, Math.cos(a) * sp, Math.sin(a) * sp, rnd(4, 9) * k, rnd(0.5, 0.9), i % 5 === 0 ? tint : (i % 5), rnd(0, TAU), rnd(-9, 9));
      }
      for (let i = 0; i < 4; i++) spawn(SMOKE, x + rnd(-10, 10), y + rnd(-10, 10), rnd(-20, 20), rnd(-30, -8), rnd(12, 20) * k, rnd(0.8, 1.3), 6);
      const s = st[1]! % sc;
      SX[s] = x;
      SY[s] = y;
      SR[s] = 16 * k;
      SL[s] = 9;
      st[1] = st[1]! + 1;
      fx.kick(power * 3.5);
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
        const drag = kind[i] === DEBRIS ? 2.6 : 1.4;
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
        const k = LIFE[i]! / MAX[i]!, c = colors[col[i]!]!, x = X[i]!, y = Y[i]!, s = SIZE[i]!;
        switch (kind[i]) {
          case DEBRIS:
            ctx.globalAlpha = Math.min(1, k * 1.6);
            ctx.fillStyle = c;
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(ROT[i]!);
            ctx.fillRect(-s / 2, -s / 2, s, s);
            ctx.restore();
            break;
          case DISC:
          case SMOKE: {
            const smoke = kind[i] === SMOKE;
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
            const r = s * (0.5 + (1 - k) * (kind[i] === RING ? 4.2 : 3));
            if (kind[i] === RING) {
              ctx.beginPath();
              ctx.arc(x, y, r, 0, TAU);
              ctx.stroke();
            } else {
              ctx.save();
              ctx.translate(x, y);
              ctx.rotate(ROT[i]!);
              ctx.strokeRect(-r / 2, -r / 2, r, r);
              ctx.restore();
            }
            break;
          }
          case WORD:
            ctx.globalAlpha = Math.min(1, k * 2);
            ctx.font = `900 ${Math.round(s * (1 + (1 - k) * 0.3))}px ui-monospace, SFMono-Regular, monospace`;
            ctx.textAlign = "center";
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(ROT[i]!);
            ctx.lineWidth = 5;
            ctx.strokeStyle = light ? "#fff" : "#07060f";
            ctx.strokeText(words[word[i]!]!, 0, 0);
            ctx.fillStyle = c;
            ctx.fillText(words[word[i]!]!, 0, 0);
            ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    },
    clear() {
      st[0] = 0;
      SL.fill(0);
      st[2] = 0;
    },
  };
  return fx;
}
export type Effects = ReturnType<typeof effects>;
