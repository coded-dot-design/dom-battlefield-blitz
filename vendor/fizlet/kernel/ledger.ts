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
/** How the browser normalises a style attribute's text (to check a restore is a no-op change). */
const withStyle = (text: string) => ((probe ??= document.createElement("i")).setAttribute("style", text), probe.style.cssText);

export class Ledger {
  private readonly texts = new Map<CharacterData, Rec<string | null>>();
  private readonly els = new Map<El, Entry>();
  private readonly added: Node[] = [];

  private entry(el: El) {
    let e = this.els.get(el);
    if (!e) this.els.set(el, (e = { hadStyle: el.hasAttribute("style"), os: el.getAttribute("style"), hadClass: el.hasAttribute("class") }));
    return e;
  }

  /** Replace a text node's value. False if the host changed it since our last write. */
  text(node: CharacterData, value: string): boolean {
    let r = this.texts.get(node);
    if (!r) this.texts.set(node, (r = { o: node.nodeValue, l: node.nodeValue, x: false }));
    if (r.x || node.nodeValue !== r.l) return !(r.x = true);
    if (r.l !== value) node.nodeValue = r.l = value;
    return true;
  }

  /** Set one inline style property (e.g. "transform", "--hp"). */
  style(el: El, prop: string, value: string, priority = ""): boolean {
    const e = this.entry(el), map = (e.style ??= new Map()), s = el.style;
    let r = map.get(prop);
    if (!r) {
      const v = s.getPropertyValue(prop), p = s.getPropertyPriority(prop);
      map.set(prop, (r = { o: v, l: v, op: p, lp: p, x: false }));
    }
    if (r.x || s.getPropertyValue(prop) !== r.l || s.getPropertyPriority(prop) !== r.lp) return !(r.x = true);
    if (r.l === value && r.lp === priority) return true;
    s.setProperty(prop, value, priority);
    r.l = s.getPropertyValue(prop);
    r.lp = s.getPropertyPriority(prop);
    return true;
  }

  /** Put one style property back now (as Recall would) and forget it: a later `style` records the
   *  value then in place as the new original. Hands off if the host changed it since our last write. */
  unstyle(el: El, prop: string): boolean {
    const r = this.els.get(el)?.style?.get(prop), s = el.style;
    if (!r) return true;
    if (r.x || s.getPropertyValue(prop) !== r.l || s.getPropertyPriority(prop) !== r.lp) return !(r.x = true);
    if (r.o) s.setProperty(prop, r.o, r.op);
    else s.removeProperty(prop);
    this.els.get(el)!.style!.delete(prop);
    return true;
  }

  /** Set (string) or remove (null) an attribute. */
  attr(el: El, name: string, value: string | null): boolean {
    const map = (this.entry(el).attr ??= new Map());
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
    const map = (this.entry(el).cls ??= new Map());
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
    this.added.push(node);
    return node;
  }

  /** Recall: put back everything we still own, newest first. Host edits win. */
  restore() {
    for (let i = this.added.length; i--; ) (this.added[i] as ChildNode).remove?.();
    for (const [node, r] of this.texts) if (!r.x && node.nodeValue === r.l) node.nodeValue = r.o;
    for (const [el, e] of this.els) {
      e.cls?.forEach((r, name) => !r.x && el.classList.contains(name) === r.l && el.classList.toggle(name, r.o));
      e.attr?.forEach((r, name) => {
        if (r.x || el.getAttribute(name) !== r.l) return;
        if (r.o === null) el.removeAttribute(name);
        else el.setAttribute(name, r.o);
      });
      let all = true;
      e.style?.forEach((r, prop) => {
        const s = el.style;
        if (r.x || s.getPropertyValue(prop) !== r.l || s.getPropertyPriority(prop) !== r.lp) return void (all = false);
        if (r.o) s.setProperty(prop, r.o, r.op);
        else s.removeProperty(prop);
      });
      // Still ours end to end: put the original attribute text back byte for byte.
      if (e.style && all && e.os !== null && el.style.cssText === withStyle(e.os)) el.setAttribute("style", e.os);
      if (e.style && !e.hadStyle && !el.getAttribute("style")) el.removeAttribute("style");
      if (e.cls && !e.hadClass && el.getAttribute("class") === "") el.removeAttribute("class");
    }
    this.added.length = 0;
    this.texts.clear();
    this.els.clear();
  }

  /** How many things the ledger holds (for stats). */
  get size() {
    let n = this.texts.size + this.added.length;
    this.els.forEach((e) => (n += (e.style?.size ?? 0) + (e.attr?.size ?? 0) + (e.cls?.size ?? 0)));
    return n;
  }
}
