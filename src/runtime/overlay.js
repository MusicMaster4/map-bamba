// Screen-space and geo-anchored DOM elements: text, labels, pins, movers, counters, legends.
import { ease as getEase, prog, clamp, lerp } from './ease.js';
import { Timed } from './layers.js';
import { rgba } from './color.js';

const h = (tag, cls, parent, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; if (parent) parent.appendChild(e); return e; };
const stag = (P, i, n, s) => clamp(P * (1 + s * (n - 1)) - s * i);

// ---- text entrance presets ----------------------------------------------------------------
// split: how the text is broken up; stagger: delay between parts (fraction of the part duration);
// apply(part, p): style a part at eased progress p (0 hidden → 1 settled).
export const TEXT_IN = {
  none: { split: null, apply: () => {} },
  fade: { split: null, apply: (e, p) => { e.style.opacity = p; } },
  rise: { split: 'line', stagger: 0.25, ease: 'outQuart', apply: (e, p) => { e.style.opacity = Math.min(1, p * 1.6); e.style.transform = `translateY(${(1 - p) * 0.55}em)`; } },
  mask: { split: 'line', stagger: 0.22, mask: true, ease: 'outQuart', apply: (e, p) => { e.style.transform = `translateY(${(1 - p) * 112}%)`; } },
  blur: { split: null, ease: 'outCubic', apply: (e, p) => { e.style.opacity = p; e.style.filter = p < 1 ? `blur(${((1 - p) * 0.35).toFixed(3)}em)` : ''; } },
  words: { split: 'word', stagger: 0.3, ease: 'outQuart', apply: (e, p) => { e.style.opacity = Math.min(1, p * 1.5); e.style.transform = `translateY(${(1 - p) * 0.4}em)`; } },
  chars: { split: 'char', stagger: 0.12, ease: 'outCubic', apply: (e, p) => { e.style.opacity = p; e.style.transform = `translateY(${(1 - p) * 0.25}em)`; } },
  type: { split: 'char', stagger: 1, ease: 'linear', apply: (e, p) => { e.style.opacity = p > 0 ? 1 : 0; } },
  track: { split: null, ease: 'outQuart', apply: (e, p) => { e.style.opacity = p; e.style.letterSpacing = `calc(var(--ls, 0em) + ${((1 - p) * 0.22).toFixed(4)}em)`; } },
  wipe: { split: null, ease: 'inOutCubic', apply: (e, p) => { e.style.clipPath = p < 1 ? `inset(-10% ${((1 - p) * 100).toFixed(2)}% -10% 0)` : ''; } },
};
export const TEXT_OUT = {
  fade: (e, p) => { e.style.opacity = 1 - p; },
  blur: (e, p) => { e.style.opacity = 1 - p; e.style.filter = p > 0 ? `blur(${(p * 0.3).toFixed(3)}em)` : ''; },
  drop: (e, p) => { e.style.opacity = 1 - p; e.style.transform = `translateY(${p * 0.5}em)`; },
  wipe: (e, p) => { e.style.clipPath = p > 0 ? `inset(-10% 0 -10% ${(p * 100).toFixed(2)}%)` : ''; },
};
const pick = (table, name, what) => { const v = table[name]; if (!v) throw new Error(`Unknown ${what} preset "${name}". Valid: ${Object.keys(table).join(', ')}`); return v; };

/** Break text into animatable parts. Returns the list of part elements. */
function splitText(root, text, preset) {
  const parts = [];
  for (const line of String(text).split('\n')) {
    const ln = h('span', 'ln' + (preset.mask ? ' ln-mask' : ''), root);
    const li = h('span', 'li', ln);
    if (preset.split === 'line' || !preset.split) { li.textContent = line; if (preset.split) parts.push(li); continue; }
    line.split(/(\s+)/).forEach((tok) => {
      if (!tok) return;
      if (/^\s+$/.test(tok)) { li.appendChild(document.createTextNode(' ')); return; }
      const w = h('span', 'w', li);
      if (preset.split === 'word') { w.textContent = tok; parts.push(w); } else for (const ch of tok) parts.push(h('span', 'ch', w, ch));
    });
  }
  return parts;
}

class Reveal {
  constructor(root, blocks, inName, outName) {
    this.root = root;
    this.in = pick(TEXT_IN, inName, 'text "in"');
    this.out = pick(TEXT_OUT, outName, 'text "out"');
    this.ease = getEase(this.in.ease || 'outCubic');
    this.parts = [];
    for (const [el, text] of blocks) this.parts.push(...splitText(el, text, this.in));
    if (!this.in.split) this.parts = [root];
  }
  apply(pin, pout) {
    const n = this.parts.length, s = this.in.stagger || 0;
    for (let i = 0; i < n; i++) this.in.apply(this.parts[i], this.in.ease === 'linear' ? stag(pin, i, n, s) : this.ease(stag(pin, i, n, s)));
    if (this.in.split) this.root.style.opacity = '';
    if (pout > 0) this.out(this.root, getEase('inCubic')(pout));
    else if (this.in.split) { this.root.style.filter = ''; this.root.style.clipPath = ''; this.root.style.transform = this.baseTransform || ''; }
  }
}

const STYLES = ['title', 'caption', 'note', 'mono', 'serif', 'quote'];

/** Shared behaviour for elements placed on the 3×3 screen grid. */
class ScreenEl extends Timed {
  constructor(scene, o, defaults) {
    super(scene, o, defaults);
    this.o = o;
    this.pos = o.pos ?? defaults.pos ?? 'bl';
  }
  place(el) {
    const o = this.o, ov = this.scene.overlay;
    if (Array.isArray(this.pos)) { ov.free.appendChild(el); el.style.position = 'absolute'; el.style.left = this.pos[0] * ov.u + 'px'; el.style.top = this.pos[1] * ov.u + 'px'; }
    else ov.anchor(this.pos).appendChild(el);
    if (o.offset) el.style.margin = `${o.offset[1] * ov.u}px ${-o.offset[0] * ov.u}px ${-o.offset[1] * ov.u}px ${o.offset[0] * ov.u}px`;
    if (o.color) el.style.color = o.color;
    if (o.width) el.style.maxWidth = o.width * ov.u + 'px';
    if (o.align) el.style.textAlign = o.align;
    this.el = el;
  }
  show(t) {
    const on = t >= this.at && (this.end === null || t < this.end + this.outDur);
    this.el.style.display = on ? '' : 'none';
    return on;
  }
  pin(t) { return prog(t, this.at, this.dur); }
  pout(t) { return this.end === null ? 0 : prog(t, this.end, this.outDur); }
}

/** Screen text. s.text(str, { pos, style, in, out, at, end, dur, size, color, sub }) */
export class TextEl extends ScreenEl {
  constructor(scene, text, o = {}) {
    super(scene, o, { dur: o.in === 'type' ? Math.max(0.6, String(text).length * 0.045) : 0.9, pos: 'bl' });
    this.text = text;
    this.style = o.style || 'caption';
    if (!STYLES.includes(this.style)) throw new Error(`Unknown text style "${this.style}". Valid: ${STYLES.join(', ')}`);
  }
  mount() {
    const o = this.o, u = this.scene.overlay.u;
    const el = h('div', `b-text b-${this.style}`);
    if (o.plate !== false) this.plate = h('div', 'b-plate', el);
    const main = h('div', 'b-main', el);
    const blocks = [[main, this.text]];
    if (o.size) main.style.fontSize = o.size * u + 'px';
    if (o.weight) main.style.fontWeight = o.weight;
    if (o.upper) main.style.textTransform = 'uppercase';
    if (o.tracking != null) { main.style.letterSpacing = o.tracking + 'em'; main.style.setProperty('--ls', o.tracking + 'em'); }
    if (o.font) main.style.fontFamily = `var(--f-${o.font})`;
    if (o.italic) main.style.fontStyle = 'italic';
    if (o.sub) blocks.push([h('div', 'b-sub', el), o.sub]);
    this.place(el);
    this.reveal = new Reveal(el, blocks, o.in || (this.style === 'title' ? 'mask' : 'rise'), o.out || 'fade');
  }
  update(t) {
    if (!this.show(t)) return;
    this.reveal.apply(this.pin(t), this.pout(t));
    if (this.plate) this.plate.style.opacity = clamp(this.pin(t) * 2.5) * (this.reveal.in.split ? 1 - this.pout(t) : 1);
  }
}

/** Animated number. s.counter({ to, from, follow: line, decimals, prefix, unit, label, pos, at, dur }) */
export class CounterEl extends ScreenEl {
  constructor(scene, o = {}) { super(scene, o, { dur: 3, pos: 'br', ease: 'inOutSine' }); }
  mount() {
    const o = this.o, u = this.scene.overlay.u;
    const el = h('div', 'b-counter');
    const row = h('div', 'b-num', el);
    if (o.prefix) h('span', 'b-unit b-pre', row, o.prefix);
    this.num = h('span', 'b-digits', row);
    if (o.unit) h('span', 'b-unit', row, o.unit);
    if (o.label) h('div', 'b-lbl', el, o.label);
    if (o.size) row.style.fontSize = o.size * u + 'px';
    this.fmt = o.format || ((v) => new Intl.NumberFormat(this.scene.cfg.locale, { minimumFractionDigits: o.decimals ?? 0, maximumFractionDigits: o.decimals ?? 0 }).format(v));
    this.place(el);
    this.fadeIn = o.fade ?? 0.6;
  }
  value(t) {
    const o = this.o;
    if (typeof o.value === 'function') return o.value(t);
    if (o.follow) return (o.from ?? 0) + ((o.to ?? o.follow.km) - (o.from ?? 0)) * o.follow.progress(t);
    return lerp(o.from ?? 0, o.to ?? 0, this.easeIn(prog(t, this.at, this.dur)));
  }
  update(t) {
    if (!this.show(t)) return;
    const v = this.value(t);
    this.num.textContent = typeof v === 'string' ? v : this.fmt(v);
    this.el.style.opacity = getEase('outCubic')(prog(t, this.at, this.fadeIn)) * (1 - this.pout(t));
  }
}

/** Colour key. s.legend([{ color, label, kind: 'fill'|'line'|'dot'|'hatch' }], { pos, at }) */
export class LegendEl extends ScreenEl {
  constructor(scene, items, o = {}) { super(scene, o, { dur: 0.8, pos: 'bl' }); this.items = items; }
  mount() {
    const el = h('div', 'b-legend');
    this.rows = this.items.map((it) => {
      const r = h('div', 'b-leg-row', el);
      const sw = h('span', 'b-sw b-sw-' + (it.kind || 'fill'), r);
      sw.style.setProperty('--c', it.color);
      h('span', 'b-leg-txt', r, it.label);
      return r;
    });
    this.place(el);
  }
  update(t) {
    if (!this.show(t)) return;
    const P = this.pin(t), n = this.rows.length, e = getEase('outQuart');
    this.rows.forEach((r, i) => { const p = e(stag(P, i, n, 0.3)); r.style.opacity = p; r.style.transform = `translateY(${(1 - p) * 0.5}em)`; });
    this.el.style.opacity = 1 - this.pout(t);
  }
}

/** Thin time axis with a moving playhead. s.timebar({ from, to, at, dur, marks: [{ at: date|number, label }], format }) */
export class TimebarEl extends ScreenEl {
  constructor(scene, o = {}) { super(scene, o, { dur: 10, pos: 'b', ease: 'linear' }); }
  mount() {
    const o = this.o, u = this.scene.overlay.u;
    const num = (v) => (typeof v === 'number' ? v : +new Date(v));
    this.a = num(o.from); this.b = num(o.to);
    const el = h('div', 'b-timebar');
    h('div', 'b-plate', el).style.opacity = 0.9;
    el.style.width = (o.width ?? 900) * u + 'px';
    const track = h('div', 'b-tb-track', el);
    this.fill = h('div', 'b-tb-fill', track);
    this.head = h('div', 'b-tb-head', track);
    for (const m of o.marks || []) {
      const x = (num(m.at) - this.a) / (this.b - this.a);
      const tick = h('div', 'b-tb-tick', track);
      tick.style.left = x * 100 + '%';
      if (m.label) h('span', 'b-tb-lbl', tick, m.label);
    }
    if (o.color) el.style.setProperty('--c', o.color);
    this.place(el);
    el.style.maxWidth = 'none';
  }
  update(t) {
    if (!this.show(t)) return;
    const p = this.easeIn(prog(t, this.at, this.dur));
    this.fill.style.width = p * 100 + '%';
    this.head.style.left = p * 100 + '%';
    this.el.style.opacity = getEase('outCubic')(prog(t, this.at - 0.001, 0.6)) * (1 - this.pout(t));
  }
}

// ---- geo-anchored ---------------------------------------------------------------------------
const SIDES = { right: [1, 0], left: [-1, 0], top: [0, -1], bottom: [0, 1], center: [0, 0] };
const LABEL_STYLES = ['city', 'place', 'water', 'note', 'tag'];
const PIN_KINDS = ['dot', 'ring', 'pulse', 'stem', 'none'];

/**
 * A point on the map with an optional label: s.pin(lnglat, text, o) / s.label(lnglat, text, o)
 * o = { kind: dot|ring|pulse|stem|none, side: right|left|top|bottom|center, style: city|place|water|note|tag,
 *       sub, color, size, offset: [dx, dy] (label displacement in px, draws a leader line), stem: px, at, end }
 */
export class PinEl extends Timed {
  constructor(scene, lnglat, text, o = {}) {
    super(scene, o, { dur: 0.9 });
    if (!lnglat || typeof lnglat[0] !== 'number') throw new Error('pin/label: first argument must be [lng, lat]');
    this.lnglat = [lnglat[0], lnglat[1]];
    this.text = text;
    this.o = { kind: 'dot', side: 'right', style: 'city', size: 12, color: scene.theme.accent, ...o };
    if (!PIN_KINDS.includes(this.o.kind)) throw new Error(`Unknown pin kind "${this.o.kind}". Valid: ${PIN_KINDS.join(', ')}`);
    if (!LABEL_STYLES.includes(this.o.style)) throw new Error(`Unknown label style "${this.o.style}". Valid: ${LABEL_STYLES.join(', ')}`);
    if (!SIDES[this.o.side]) throw new Error(`Unknown side "${this.o.side}". Valid: ${Object.keys(SIDES).join(', ')}`);
  }
  mount() {
    const o = this.o, ov = this.scene.overlay, u = ov.u;
    const el = (this.el = h('div', 'g-pin', ov.geo));
    el.style.setProperty('--c', o.color);
    const size = o.size * u;
    let anchor = [0, 0]; // where the label attaches, relative to the point
    if (o.kind === 'stem') {
      const len = (o.stem ?? 70) * u;
      this.stem = h('div', 'g-stem', el);
      this.stem.style.height = len + 'px';
      anchor = [0, -len];
    }
    if (o.kind !== 'none') {
      if (o.kind === 'pulse') this.rings = [0, 1].map(() => { const r = h('div', 'g-ring-fx', el); r.style.width = r.style.height = size + 'px'; return r; });
      this.dot = h('div', 'g-dot g-dot-' + (o.kind === 'ring' ? 'ring' : 'solid'), el);
      this.dot.style.width = this.dot.style.height = size + 'px';
    }
    if (this.text) {
      let side = o.side;
      let dx, dy;
      if (o.offset) {
        [dx, dy] = [o.offset[0] * u, o.offset[1] * u];
        const len = Math.hypot(dx, dy);
        if (len > 20 * u && o.leader !== false) {
          this.leader = h('div', 'g-leader', el);
          this.leader.style.width = len - 6 * u + 'px';
          this.leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
        }
        if (!o.side || o.side === 'right') side = Math.abs(dx) >= Math.abs(dy) * 0.6 ? (dx >= 0 ? 'right' : 'left') : dy < 0 ? 'top' : 'bottom';
      } else {
        const gap = (o.kind === 'none' ? 0 : size / 2 + 9 * u) + (o.kind === 'stem' ? 2 * u : 0);
        const sd = o.kind === 'stem' && o.side === 'right' ? 'top' : o.side;
        side = sd;
        [dx, dy] = [anchor[0] + SIDES[sd][0] * gap, anchor[1] + SIDES[sd][1] * gap];
      }
      const lab = (this.lab = h('div', `g-label g-${o.style} g-side-${side}`, el));
      lab.style.left = dx + 'px';
      lab.style.top = dy + 'px';
      const inner = (this.inner = h('div', 'g-label-in', lab));
      h('div', 'g-name', inner, this.text);
      if (o.sub) h('div', 'g-sub', inner, o.sub);
      if (o.labelColor) inner.style.color = o.labelColor;
      if (o.textSize) inner.style.fontSize = o.textSize * u + 'px';
      this.side = SIDES[side];
    }
  }
  update(t) {
    const on = t >= this.at && (this.end === null || t < this.end + this.outDur);
    const pt = on ? this.scene.project(this.lnglat, (this.o.alt || 0) * (this.o.altGrow ? getEase('outCubic')(prog(t, this.at, this.dur)) : 1)) : null;
    if (!on || !pt.visible) { this.el.style.display = 'none'; return; }
    this.el.style.display = '';
    this.el.style.transform = `translate(${pt.x.toFixed(2)}px, ${pt.y.toFixed(2)}px)`;
    const P = prog(t, this.at, this.dur);
    const out = this.end === null ? 0 : getEase('inOutCubic')(prog(t, this.end, this.outDur));
    this.el.style.opacity = 1 - out;
    if (this.dot) this.dot.style.transform = `translate(-50%, -50%) scale(${getEase('spring')(clamp(P / 0.7))})`;
    if (this.stem) this.stem.style.transform = `translateX(-50%) scaleY(${getEase('outQuart')(clamp(P / 0.6))})`;
    if (this.rings) this.rings.forEach((r, i) => {
      const q = (((t - this.at) / 2.4 + i * 0.5) % 1 + 1) % 1;
      r.style.transform = `translate(-50%, -50%) scale(${1 + q * 3.2})`;
      r.style.opacity = (1 - q) ** 2 * 0.8 * clamp(P * 2);
    });
    if (this.leader) { const p = getEase('outQuart')(clamp((P - 0.1) / 0.6)); this.leader.style.clipPath = `inset(-2px ${(1 - p) * 100}% -2px 0)`; }
    if (this.lab) {
      const p = getEase('outQuart')(clamp((P - 0.3) / 0.7));
      this.inner.style.opacity = p;
      this.inner.style.transform = `translate(${(-this.side[0] * (1 - p) * 0.5).toFixed(3)}em, ${((this.side[1] === 0 ? 0 : -this.side[1]) * (1 - p) * 0.4).toFixed(3)}em)`;
    }
  }
}

export const ICONS = {
  plane: '<path d="M24 2c1.9 0 3.1 2.7 3.1 6.6V18l17.4 10.6v4.2L27.1 27.6v10.2l5.6 4.1v3.2L24 42.7l-8.7 2.4v-3.2l5.6-4.1V27.6L3.5 32.8v-4.2L20.9 18V8.6C20.9 4.7 22.1 2 24 2z"/>',
  arrow: '<path d="M24 5l14.5 35.5L24 33.2 9.5 40.5z"/>',
  ship: '<path d="M24 3c6.5 8.6 9 16.4 9 26v13.5H15V29c0-9.600 2.5-17.400 9-26z"/><path d="M19 27h10v10H19z" opacity=".35" fill="#000"/>',
  car: '<path d="M17 6h14a6 6 0 016 6v24a6 6 0 01-6 6H17a6 6 0 01-6-6V12a6 6 0 016-6z"/><path d="M15.500 15.500c5.400-2 11.600-2 17 0l-1.200 6.500h-14.600zM16.800 32h14.400l1 5c-5.300 1.600-11.100 1.600-16.400 0z" opacity=".4" fill="#000"/>',
  dot: '<circle cx="24" cy="24" r="11"/>',
};

/**
 * An icon travelling along a line: s.mover(line, { icon, size, color, at, dur, ease, rotate })
 * With no at/dur it rides the head of the line as the line draws.
 */
export class MoverEl extends Timed {
  constructor(scene, line, o = {}) {
    const span = line.drawSpan?.();
    super(scene, { ...o, at: o.at ?? span?.at }, { dur: span?.dur ?? 5 });
    this.line = line;
    this.own = o.at !== undefined || !line.hasDraw;
    this.o = { icon: 'arrow', size: 40, color: scene.theme.fg, rotate: true, ...o };
    this.move = getEase(o.ease || 'inOutSine');
    if (!ICONS[this.o.icon] && !String(this.o.icon).includes('<')) throw new Error(`Unknown icon "${this.o.icon}". Valid: ${Object.keys(ICONS).join(', ')} or an SVG string (48×48 viewBox, pointing up)`);
  }
  frac(t) { return this.own ? this.move(prog(t, this.at, this.dur)) : this.line.progress(t); }
  mount() {
    const o = this.o, u = this.scene.overlay.u;
    const el = (this.el = h('div', 'g-mover', this.scene.overlay.geo));
    const s = o.size * u;
    el.innerHTML = `<svg viewBox="0 0 48 48" width="${s}" height="${s}" fill="${o.color}">${ICONS[o.icon] || o.icon}</svg>`;
    this.svg = el.firstChild;
    if (o.halo !== false) this.svg.style.filter = `drop-shadow(0 0 ${3 * u}px ${rgba(this.scene.theme.dark ? '#000' : this.scene.theme.bg, 0.85)}) drop-shadow(0 ${2 * u}px ${6 * u}px rgba(0,0,0,.45))`;
  }
  update(t) {
    const fadeIn = prog(t, this.at, 0.5);
    const out = this.end === null ? 0 : prog(t, this.end, this.outDur);
    const f = this.frac(t);
    const pt = this.scene.project(this.line.metric.at(f));
    if (t < this.at || out >= 1 || !pt.visible) { this.el.style.display = 'none'; return; }
    this.el.style.display = '';
    let rot = 0;
    if (this.o.rotate) {
      const d = Math.max(0.0015, 2 / (this.line.km * 1000 + 1));
      const a = this.scene.project(this.line.metric.at(Math.max(0, f - d))), b = this.scene.project(this.line.metric.at(Math.min(1, f + d)));
      rot = Math.atan2(b.y - a.y, b.x - a.x) + Math.PI / 2;
    }
    this.el.style.transform = `translate(${pt.x.toFixed(2)}px, ${pt.y.toFixed(2)}px) rotate(${rot.toFixed(4)}rad) scale(${0.6 + 0.4 * getEase('outBack')(fadeIn)})`;
    this.el.style.opacity = fadeIn * (1 - out);
  }
}

/** DOM scaffolding: stage layers, the 3×3 anchor grid, scrims, vignette and grain. */
export class Overlay {
  constructor(scene, stage) {
    this.scene = scene;
    const { width: W, height: H, theme, cfg } = scene;
    this.u = Math.min(W, H) / 1080;
    stage.style.setProperty('--u', this.u);
    stage.style.setProperty('--bg', theme.bg);
    stage.style.setProperty('--fg', theme.fg);
    stage.style.setProperty('--accent', theme.accent);
    stage.style.setProperty('--halo', theme.dark ? rgba(theme.bg, 0.9) : rgba(theme.bg, 0.92));
    stage.style.setProperty('--m', (cfg.margin ?? 72) * this.u + 'px');
    this.sphere = scene.cfg.globe ? h('div', 'sphere', stage) : null;
    this.scrim = h('div', 'scrims', stage);
    this.geo = h('div', 'geo', stage);
    this.ui = h('div', 'ui', stage);
    this.free = h('div', 'free', stage);
    this.anchors = {};
    this.post = h('div', 'post', stage);
  }
  anchor(pos) {
    const ok = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'];
    if (!ok.includes(pos)) throw new Error(`Unknown pos "${pos}". Valid: ${ok.join(', ')} or [x, y] in px`);
    return (this.anchors[pos] ??= h('div', 'anchor a-' + pos, this.ui));
  }
  finish() {
    const { theme, cfg } = this.scene;
    const s = cfg.scrim === false ? 0 : cfg.scrim === true || cfg.scrim == null ? 0.4 : cfg.scrim;
    const used = Object.keys(this.anchors);
    const sT = theme.dark ? s : s * 0.55;
    if (s > 0) {
      if (used.some((a) => a[0] === 'b')) h('div', 'scrim scrim-b', this.scrim).style.background = `linear-gradient(to top, ${rgba(theme.bg, s)} 0%, ${rgba(theme.bg, s * 0.55)} 45%, ${rgba(theme.bg, 0)} 100%)`;
      if (used.some((a) => a[0] === 't')) h('div', 'scrim scrim-t', this.scrim).style.background = `linear-gradient(to bottom, ${rgba(theme.bg, sT * 0.9)} 0%, ${rgba(theme.bg, sT * 0.5)} 45%, ${rgba(theme.bg, 0)} 100%)`;
    }
    // Grain is static by default (a paper-like texture that also dithers dark gradients): it costs almost
    // no bitrate. post.grainMotion = true re-seeds it every frame for a filmic look at ~2× the file size.
    const post = { vignette: 0.3, grain: 0.022, grainMotion: false, ...(cfg.post || {}) };
    this.grainMotion = post.grainMotion;
    if (post.vignette > 0) h('div', 'vignette', this.post).style.background = `radial-gradient(ellipse 75% 75% at 50% 50%, rgba(0,0,0,0) 52%, ${rgba(theme.dark ? '#000' : theme.fg, post.vignette * (theme.dark ? 1 : 0.35))} 130%)`;
    if (post.grain > 0) {
      this.grain = h('div', 'grain', this.post);
      this.grain.style.backgroundImage = `url(${noiseTile(post.grain)})`;
    }
    if (cfg.credit !== false) h('div', 'credit', this.post, [cfg.credit && cfg.credit !== true ? cfg.credit : null, '© OpenStreetMap'].filter(Boolean).join(' · '));
  }
  /** Soft limb shading + rim light so the globe reads as a lit sphere. */
  globe(tr, cam) {
    const R = tr.worldSize / (2 * Math.PI) / Math.cos((cam.center[1] * Math.PI) / 180), cd = tr.cameraToCenterDistance, d = R + cd;
    const r = (cd * R) / Math.sqrt(d * d - R * R);
    const a = clamp((5.2 - cam.zoom) / 1.2) * clamp(1 - cam.pitch / 25);
    const s = this.sphere.style;
    s.opacity = a;
    s.width = s.height = 2 * r + 'px';
    s.left = this.scene.width / 2 - r + 'px';
    s.top = this.scene.height / 2 - r + 'px';
  }
  frame(i) {
    if (!this.grain || !this.grainMotion) return;
    const r = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
    this.grain.style.backgroundPosition = `${Math.floor(r(i) * 384)}px ${Math.floor(r(i + 0.5) * 384)}px`;
  }
}

function noiseTile(strength) {
  const n = 256, c = document.createElement('canvas');
  c.width = c.height = n;
  const x = c.getContext('2d'), img = x.createImageData(n, n);
  let seed = 1337;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < n * n; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = rnd() * rnd() * 255 * strength * 2.2;
  }
  x.putImageData(img, 0, 0);
  return c.toDataURL();
}
