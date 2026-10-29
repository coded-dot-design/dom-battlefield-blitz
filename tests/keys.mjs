// Page keys check (Board UI kit, BOARD-UI.md "Page keys"): every visible in-page key is a
// `.bui-key`, and for each one a press shows (the face drops by its base, --py) and the click lands
// on the key whether the pointer is on the face's centre, just under its top edge (which the
// dropping face leaves) or on the base below it. Keyboard Enter shows the press (.down) too.
// Clicks are caught at the window and cancelled, so nothing navigates and no handler runs.
// Shared by the site tests; `page` is a Playwright page already loaded.
import assert from "node:assert/strict";

/** Kit key families an in-page <a> or <button> may wear; each must also be a .bui-key. */
const FAMILIES = ".bui-arcade, .bui-icon-key, .bui-sticker-key";

/** The key's base height (--py) in px: a probe sized by it (custom properties compute as text). */
const basePx = (key) => key.evaluate((e) => {
  const probe = e.appendChild(document.createElement("i"));
  probe.style.cssText = "position:absolute;width:var(--py);height:0;padding:0;border:0";
  const px = probe.getBoundingClientRect().width;
  probe.remove();
  return px;
});

/** Number the page's enabled, visible, pressable keys (a decorative key with pointer-events: none
 *  inside a card link is the card's, not a key) and catch every click (recording which key it hit).
 *  Taps: keys that act on touchstart (the kit's press()) cancel the click, so their touchstart is
 *  held back here and the tap's native click shows where it landed. */
async function prepare(page, skip, taps = false) {
  await page.evaluate((taps) => {
    window.__hits = [];
    if (taps) addEventListener("touchstart", (e) => e.stopImmediatePropagation(), { capture: true, passive: true });
    addEventListener("click", (e) => {
      window.__hits.push(e.target.closest?.(".bui-key")?.dataset.keyId ?? null);
      e.preventDefault();
      e.stopImmediatePropagation();
    }, true);
  }, taps);
  return page.evaluate((skip) => {
    let n = 0;
    return [...document.querySelectorAll(".bui-key")]
      .filter((e) => !(skip && e.closest(skip)) && e.getClientRects().length && !e.matches(":disabled, [aria-disabled='true']") && getComputedStyle(e).pointerEvents !== "none")
      .map((e) => (e.dataset.keyId = String(n++)));
  }, skip);
}

export async function checkKeys(page, label, { skip = "" } = {}) {
  const stray = await page.evaluate(([families, skip]) =>
    [...document.querySelectorAll(`:is(a, button):is(${families}):not(.bui-key)`)]
      .filter((e) => !(skip && e.closest(skip)) && e.getClientRects().length)
      .map((e) => e.outerHTML.slice(0, 90)), [FAMILIES, skip]);
  assert.deepEqual(stray, [], `${label}: in-page keys without .bui-key`);
  const ids = await prepare(page, skip);
  assert.ok(ids.length > 0, `${label}: no keys found`);
  for (const id of ids) {
    const key = page.locator(`[data-key-id="${id}"]`);
    await key.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
    const box = await key.boundingBox();
    const py = await basePx(key);
    const name = `${label}: key ${JSON.stringify((await key.textContent()).trim().slice(0, 30) || (await key.getAttribute("aria-label")))}`;
    assert.ok(py > 0, `${name} has a base`);
    const x = box.x + box.width / 2;
    // A locked key (aria-pressed) rests dropped: its base is under the face, so measure from rest.
    await page.mouse.move(2, 2);
    await page.waitForTimeout(150);
    const rest = await key.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m42);
    for (const [where, y] of [["centre", box.y + box.height / 2], ["top edge", box.y + 1], ["base", box.y + box.height - rest + py / 2]]) {
      await page.mouse.move(2, 2);
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.waitForTimeout(90);
      const ty = await key.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m42);
      assert.ok(Math.abs(ty - py) < 0.5, `${name} at the ${where}: the face drops by its base (${ty} vs ${py})`);
      await page.mouse.up();
      const hits = await page.evaluate(() => window.__hits.splice(0));
      assert.deepEqual(hits, [id], `${name} at the ${where}: the click lands on the key`);
    }
    await page.mouse.move(2, 2);
    await key.focus();
    await page.keyboard.down("Enter");
    assert.ok(await key.evaluate((e) => e.classList.contains("down")), `${name}: Enter shows the press`);
    await page.keyboard.up("Enter");
    assert.ok(!(await key.evaluate((e) => e.classList.contains("down"))), `${name}: release lifts it`);
    await page.evaluate(() => window.__hits.splice(0));
  }
  return ids.length;
}

/** Phones: a tap on the base (below the face) still clicks the key. */
export async function checkTaps(page, label, { skip = "" } = {}) {
  const ids = await prepare(page, skip, true);
  for (const id of ids) {
    const key = page.locator(`[data-key-id="${id}"]`);
    await key.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "instant" }));
    const box = await key.boundingBox();
    const py = await basePx(key);
    const rest = await key.evaluate((e) => new DOMMatrix(getComputedStyle(e).transform).m42);
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height - rest + py / 2);
    const hits = await page.evaluate(() => window.__hits.splice(0));
    assert.deepEqual(hits, [id], `${label}: a tap on the base of key ${id} clicks it`);
  }
  return ids.length;
}
