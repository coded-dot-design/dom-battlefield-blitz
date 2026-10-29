// Young-generation GC counting in Chromium, for the zero-allocation test: V8's own trace events
// (devtools.timeline MinorGC) over a measured window, read through the DevTools protocol.
// A stray scavenge can come from the page or JIT work, so a check measures several windows and
// keeps the best one: real per-step allocation shows in every window, noise does not.

/** Runs `work(arg)` in the page in `windows` separate measured windows; returns the fewest minor GCs seen. */
export async function minorGCs(page, work, arg, windows = 3) {
  const cdp = await page.context().newCDPSession(page);
  let best = Infinity;
  try {
    for (let w = 0; w < windows && best > 0; w++) {
      await cdp.send("HeapProfiler.collectGarbage");
      let minor = 0;
      const count = ({ value }) => {
        for (const ev of value) if (ev.name === "MinorGC" && ev.ph !== "E") minor++;
      };
      cdp.on("Tracing.dataCollected", count);
      const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
      await cdp.send("Tracing.start", { categories: "devtools.timeline", transferMode: "ReportEvents" });
      await page.evaluate(work, arg);
      await cdp.send("Tracing.end");
      await done;
      cdp.off("Tracing.dataCollected", count);
      best = Math.min(best, minor);
    }
  } finally {
    await cdp.detach();
  }
  return best;
}
