/** One event in the ring. Slots are reused; copy what you need before the next frame. */
export interface FizEvent {
  type: string;
  a: number;
  b: number;
  x: number;
  y: number;
  v: number;
}
/** Fixed-capacity event ring, filled during a frame's steps and read in render (sound adapter,
 *  effects, HUD). Harnesses talk through it instead of callbacks. Full = the event is dropped. */
export class EventRing {
  readonly cap: number;
  size = 0;
  dropped = 0;
  private readonly slots: FizEvent[] = [];
  constructor(cap = 64) {
    this.cap = cap;
    for (let i = 0; i < cap; i++) this.slots.push({ type: "", a: 0, b: 0, x: 0, y: 0, v: 0 });
  }
  emit(type: string, a = 0, b = 0, x = 0, y = 0, v = 0): boolean {
    if (this.size === this.cap) return (this.dropped++, false);
    const s = this.slots[this.size++]!;
    s.type = type;
    s.a = a;
    s.b = b;
    s.x = x;
    s.y = y;
    s.v = v;
    return true;
  }
  at(i: number): FizEvent | undefined {
    return i < this.size ? this.slots[i] : undefined;
  }
  clear() {
    this.size = 0;
  }
}
