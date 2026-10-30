/**
 * Screen-reader announcements through ONE polite live region per document (`[data-fz-announce]`).
 * Same contract as Fizlet's `fizlet/announce` brick; a later vendor sync swaps this import for it.
 *
 *   const a = announcer({ gap: 1 });  // at most one write per `gap` seconds
 *   a.say("score", "3 kills");          // queued under its key; a newer text for a key replaces it
 *   a.flush();                          // write what's pending now (a match result)
 *   a.destroy();                        // timers off; the region goes if this one made it
 *
 * Call it change-only from HUD/render code, never from the fixed step: it allocates per call.
 */
export interface Announcer {
  say(key: string, text: string): void;
  flush(): void;
  destroy(): void;
}

export function announcer({ gap = 1, doc = document }: { gap?: number; doc?: Document } = {}): Announcer {
  const pending = new Map<string, string>();
  let region: HTMLElement | null = null, made = false, timer = 0, at = -1e9, prev = "";
  const write = () => {
    clearTimeout(timer);
    timer = 0;
    if (!pending.size) return;
    let text = [...pending.values()].join(". ");
    pending.clear();
    // The same words again must still be heard: toggle a trailing space so the region changes.
    if (text === prev.trimEnd()) text = prev.endsWith(" ") ? text : text + " ";
    if (!region) {
      region = doc.querySelector<HTMLElement>("[data-fz-announce]");
      if (!region) {
        region = doc.createElement("div");
        region.dataset.fzAnnounce = "";
        region.setAttribute("role", "status");
        region.setAttribute("aria-live", "polite");
        region.setAttribute("aria-atomic", "true");
        region.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap";
        doc.body.append(region);
        made = true;
      }
    }
    region.textContent = prev = text;
    at = performance.now();
  };
  const later = () => {
    if (!timer) timer = setTimeout(write, Math.max(0, at + gap * 1000 - performance.now())) as unknown as number;
  };
  return {
    say(key, text) {
      pending.set(key, text); // a replaced key keeps its first-queued place
      later();
    },
    flush: write,
    destroy() {
      clearTimeout(timer);
      timer = 0;
      pending.clear();
      if (made) region?.remove();
      region = null;
      made = false;
    },
  };
}
