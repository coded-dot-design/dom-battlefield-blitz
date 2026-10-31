/**
 * The ledger: every change the engine makes to the page goes through here, so `restore()` (Recall)
 * puts the page back exactly. It is also the change-only writer: writing the value already there
 * touches nothing. Rule: a newer edit by the host page always wins (we never overwrite it, and we
 * never restore over it). Merged from the DOM VIRUS core MutationLedger and Swarm's style/attribute
 * ledgers; adds classes and nodes the engine adds to the page.
 */
type El = HTMLElement | SVGElement;
interface Rec<V> {
  /** Value before the engine's first write. */
  o: V;
  /** The engine's last write. */
  l: V;
  /** The host changed it after us: hands off for good. */
  x: boolean;
}
interface StyleRec extends Rec<string> {
  op: string;
  lp: string;
}
interface Entry {
  style?: Map<string, StyleRec>;
  attr?: Map<string, Rec<string | null>>;
  cls?: Map<string, Rec<boolean>>;
  hadStyle: boolean;
  /** The style attribute text before our first write (restored verbatim when we still own it all). */
  os: string | null;
  hadClass: boolean;
}

let probe: HTMLElement | undefined;
/** How the browser normalises a style attribute's text (to check a restore is a no-op change). The
 *  probe comes from the element's own document (an iframe's page has no global `document` of its own). */
const withStyle = (text: string, el: El) => ((probe ??= el.ownerDocument.createElement("i")).setAttribute("style", text), probe.style.cssText);
/** The host changed this property since our last write (or did before): hands off. */
const lost = (r: StyleRec, s: CSSStyleDeclaration, prop: string) => r.x || s.getPropertyValue(prop) !== r.l || s.getPropertyPriority(prop) !== r.lp;
/** Put a property's original value back (removed if it had none). */
const back = (r: StyleRec, s: CSSStyleDeclaration, prop: string) => (r.o ? s.setProperty(prop, r.o, r.op) : s.removeProperty(prop));

/** Records every change the engine makes to the page (styles, attributes, classes, text, added
 *  nodes) so `restore()` puts it back exactly. Writes that change nothing touch nothing, and an
 *  edit the host page made after ours always wins. Each engine has one: `engine.ledger`. */
export class Ledger {
  // Private names are short on purpose: esbuild keeps property names, and every byte here ships in
  // every page build. t: text nodes, m: elements, a: nodes we added, e(): an element's entry.
  private readonly t = new Map<CharacterData, Rec<string | null>>();
  private readonly m = new Map<El, Entry>();
  private readonly a: Node[] = [];

  private e(el: El) {
    let e = this.m.get(el);
    if (!e) this.m.set(el, (e = { hadStyle: el.hasAttribute("style"), os: el.getAttribute("style"), hadClass: el.hasAttribute("class") }));
    return e;
  }

  /** Replace a text node's value. False if the host changed it since our last write. */
  text(node: CharacterData, value: string): boolean {
    let r = this.t.get(node);
    if (!r) this.t.set(node, (r = { o: node.nodeValue, l: node.nodeValue, x: false }));
    if (r.x || node.nodeValue !== r.l) return !(r.x = true);
    if (r.l !== value) node.nodeValue = r.l = value;
    return true;
  }

  /** Set one inline style property (e.g. "transform", "--hp"). */
  style(el: El, prop: string, value: string, priority = ""): boolean {
    const e = this.e(el), map = (e.style ??= new Map()), s = el.style;
    let r = map.get(prop);
    if (!r) {
      const v = s.getPropertyValue(prop), p = s.getPropertyPriority(prop);
      map.set(prop, (r = { o: v, l: v, op: p, lp: p, x: false }));
    }
    if (lost(r, s, prop)) return !(r.x = true);
    if (r.l === value && r.lp === priority) return true;
    s.setProperty(prop, value, priority);
    r.l = s.getPropertyValue(prop);
    r.lp = s.getPropertyPriority(prop);
    return true;
  }

  /** Put one style property back now (as Recall would) and forget it: a later `style` records the
   *  value then in place as the new original. Hands off if the host changed it since our last write. */
  unstyle(el: El, prop: string): boolean {
    const r = this.m.get(el)?.style?.get(prop), s = el.style;
    if (!r) return true;
    if (lost(r, s, prop)) return !(r.x = true);
    back(r, s, prop);
    this.m.get(el)!.style!.delete(prop);
    return true;
  }

  /** Set (string) or remove (null) an attribute. */
  attr(el: El, name: string, value: string | null): boolean {
    const map = (this.e(el).attr ??= new Map());
    let r = map.get(name);
    if (!r) {
      const v = el.getAttribute(name);
      map.set(name, (r = { o: v, l: v, x: false }));
    }
    if (r.x || el.getAttribute(name) !== r.l) return !(r.x = true);
    if (r.l === value) return true;
    if (value === null) el.removeAttribute(name);
    else el.setAttribute(name, value);
    r.l = value;
    return true;
  }

  /** Add or remove one class. */
  cls(el: El, name: string, on: boolean): boolean {
    const map = (this.e(el).cls ??= new Map());
    let r = map.get(name);
    if (!r) {
      const v = el.classList.contains(name);
      map.set(name, (r = { o: v, l: v, x: false }));
    }
    if (r.x || el.classList.contains(name) !== r.l) return !(r.x = true);
    if (r.l !== on) el.classList.toggle(name, (r.l = on));
    return true;
  }

  /** A node the engine put on the page (canvas, overlay, debris): removed on restore. */
  add<N extends Node>(node: N): N {
    this.a.push(node);
    return node;
  }

  /** Recall: put back everything we still own, newest first. Host edits win. */
  restore() {
    for (let i = this.a.length; i--; ) (this.a[i] as ChildNode).remove?.();
    for (const [node, r] of this.t) if (!r.x && node.nodeValue === r.l) node.nodeValue = r.o;
    for (const [el, e] of this.m) {
      e.cls?.forEach((r, name) => !r.x && el.classList.contains(name) === r.l && el.classList.toggle(name, r.o));
      e.attr?.forEach((r, name) => !r.x && el.getAttribute(name) === r.l && (r.o === null ? el.removeAttribute(name) : el.setAttribute(name, r.o)));
      let all = true;
      e.style?.forEach((r, prop) => {
        const s = el.style;
        if (lost(r, s, prop)) return void (all = false);
        back(r, s, prop);
      });
      // Still ours end to end: put the original attribute text back byte for byte.
      if (e.style && all && e.os !== null && el.style.cssText === withStyle(e.os, el)) el.setAttribute("style", e.os);
      if (e.style && !e.hadStyle && !el.getAttribute("style")) el.removeAttribute("style");
      if (e.cls && !e.hadClass && el.getAttribute("class") === "") el.removeAttribute("class");
    }
    this.a.length = 0;
    this.t.clear();
    this.m.clear();
  }

  /** How many things the ledger holds (for stats). */
  get size() {
    let n = this.t.size + this.a.length;
    this.m.forEach((e) => (n += (e.style?.size ?? 0) + (e.attr?.size ?? 0) + (e.cls?.size ?? 0)));
    return n;
  }
}
