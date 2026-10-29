/** Fizlet: tiny physics for your page. The kernel is the whole default export: one shared
 *  requestAnimationFrame for every engine on the page, a fixed 60 Hz step with a catch-up cap,
 *  auto-pause, bounded pools, the event ring, seeded random, settle and an fps cap for page
 *  interactions, and the ledger that gives the page back on destroy(). Every brick is its own subpath. */
export * from "./kernel/index";
