const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

function createDomEnv() {
  const listeners = { window: new Map() };
  const elements = [];

  class MockClassList {
    constructor(el) { this.el = el; this.set = new Set(); }
    add(...names) { names.forEach(n => this.set.add(n)); }
    remove(...names) { names.forEach(n => this.set.delete(n)); }
    contains(name) { return this.set.has(name); }
  }

  class MockElement {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.className = '';
      this.id = '';
      this.style = {};
      this.dataset = {};
      this.attributes = new Map();
      this.children = [];
      this.parentNode = null;
      this.hidden = false;
      this.value = '';
      this.textContent = '';
      this.offsetWidth = 220;
      this.offsetHeight = 130;
      this.classList = new MockClassList(this);
      this._listeners = new Map();
    }
    setAttribute(k, v) { this.attributes.set(k, String(v)); }
    getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
    removeAttribute(k) { this.attributes.delete(k); }
    set title(v) { this.setAttribute('title', v); }
    get title() { return this.getAttribute('title') || ''; }
    appendChild(child) {
      if (child && child._isFragment) {
        child.children.forEach(c => this.appendChild(c));
        return child;
      }
      child.parentNode = this;
      this.children.push(child);
      return child;
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    dispatchEvent(ev) {
      const list = this._listeners.get(ev.type) || [];
      for (const fn of list) fn(ev);
    }
    focus() {}
    select() {}
    contains(node) {
      if (node === this) return true;
      return this.children.some(c => c.contains(node));
    }
    closest(selector) {
      if (selector === '.chip-btn' && this.className.includes('chip-btn')) return this;
      if (selector === '#ggb-container canvas' && this._isGgbCanvas) return this;
      return null;
    }
    set innerHTML(html) {
      // Minimal parser for popup elements referenced by quick-rename.js
      this._rawHtml = html;
      this.children = [];
      if (html.includes('id="qr-input"')) {
        const badge = new MockElement('span'); badge.id = 'qr-badge-text'; badge.textContent = 'ĐIỂM';
        const cur = new MockElement('strong'); cur.id = 'qr-current-name';
        const inp = new MockElement('input'); inp.id = 'qr-input';
        const err = new MockElement('div'); err.id = 'qr-error'; err.hidden = true;
        const chips = new MockElement('div'); chips.id = 'qr-chips';
        this.appendChild(badge);
        this.appendChild(cur);
        this.appendChild(inp);
        this.appendChild(err);
        this.appendChild(chips);
      }
    }
    get innerHTML() { return this._rawHtml || ''; }
    querySelector(sel) {
      const id = sel.startsWith('#') ? sel.slice(1) : null;
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      const walk = (node) => {
        for (const c of node.children) {
          if (id && c.id === id) return c;
          if (cls && c.className.split(/\s+/).includes(cls)) return c;
          const found = walk(c);
          if (found) return found;
        }
        return null;
      };
      return walk(this);
    }
    querySelectorAll(sel) {
      const cls = sel.startsWith('.') ? sel.slice(1) : null;
      const out = [];
      const walk = (node) => {
        for (const c of node.children) {
          if (cls && c.className.split(/\s+/).includes(cls)) out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
  }

  const body = new MockElement('body');
  const canvas = new MockElement('canvas');
  canvas._isGgbCanvas = true;
  const toolbar = new MockElement('div');
  toolbar.className = 'toolbar';

  const doc = {
    body,
    createElement: (tag) => {
      const el = new MockElement(tag);
      elements.push(el);
      return el;
    },
    createDocumentFragment: () => ({ _isFragment: true, children: [], appendChild(c) { this.children.push(c); } }),
    querySelector: (sel) => body.querySelector(sel),
    querySelectorAll: (sel) => body.querySelectorAll(sel)
  };

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener: (type, fn) => {
      if (!listeners.window.has(type)) listeners.window.set(type, []);
      listeners.window.get(type).push(fn);
    },
    dispatchWindowEvent: (type, ev) => {
      const list = listeners.window.get(type) || [];
      for (const fn of list) fn(ev);
    }
  };

  global.document = doc;
  global.window = win;
  global.requestAnimationFrame = (cb) => { cb(); return 1; };

  return { doc, win, body, canvas, toolbar };
}

function createMockGgbApi() {
  const objects = new Map([
    ['A', 'point'],
    ['B', 'point'],
    ['s', 'segment']
  ]);
  let clientCb = null;
  let clickCb = null;
  let renameShouldSucceed = true;
  const renamed = [];

  return {
    objects,
    renamed,
    setRenameResult(val) { renameShouldSucceed = val; },
    registerClientListener(cb) { clientCb = cb; },
    registerClickListener(cb) { clickCb = cb; },
    triggerSelect(name) { if (clientCb) clientCb({ type: 'select', target: name }); },
    triggerClick(name) { if (clickCb) clickCb(name); },
    exists(name) { return objects.has(name); },
    getObjectType(name) { return objects.get(name) || ''; },
    renameObject(oldName, newName) {
      if (!renameShouldSucceed) return false;
      const t = objects.get(oldName);
      objects.delete(oldName);
      objects.set(newName, t);
      renamed.push([oldName, newName]);
      return true;
    }
  };
}

describe('Quick Rename Unit Tests', () => {
  it('computeSuggestionChips should exclude existing/current names, avoid duplicates, and surface B prime / C prime', () => {
    const { computeSuggestionChips } = require('../src/quick-rename.js');
    assert.equal(typeof computeSuggestionChips, 'function');

    const existing = new Set(['A', 'M', 'H', 'O']);
    const chips = computeSuggestionChips('A', (name) => existing.has(name), 6);
    assert.deepEqual(chips, ["A'", 'I', 'K', "B'", "C'"]);
  });

  it('initQuickRename should be idempotent, respect canvas/point-only contextmenu, sync dismissQuickRenamePopup, and show inline errors', () => {
    const { win, body, canvas, toolbar } = createDomEnv();
    delete require.cache[require.resolve('../src/quick-rename.js')];
    const { initQuickRename } = require('../src/quick-rename.js');
    const ggbApi = createMockGgbApi();

    initQuickRename(ggbApi);
    initQuickRename(ggbApi); // Should be idempotent
    assert.equal(body.querySelectorAll('.quick-rename-popup').length, 1);
    assert.equal(typeof win.dismissQuickRenamePopup, 'function');

    // Select point A and right-click on canvas -> should open
    ggbApi.triggerSelect('A');
    let prevented = false;
    win.dispatchWindowEvent('contextmenu', {
      target: canvas,
      clientX: 100,
      clientY: 120,
      preventDefault() { prevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() {}
    });
    assert.equal(prevented, true);
    const popup = body.querySelector('.quick-rename-popup');
    assert.equal(popup.style.display, 'block');

    // dismissQuickRenamePopup closes and returns true; second call returns false; subsequent right-click re-opens cleanly
    assert.equal(win.dismissQuickRenamePopup(), true);
    assert.equal(popup.style.display, 'none');
    assert.equal(win.dismissQuickRenamePopup(), false);

    win.dispatchWindowEvent('contextmenu', {
      target: canvas,
      clientX: 150,
      clientY: 160,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {}
    });
    assert.equal(popup.style.display, 'block');

    // Right-click outside canvas (toolbar) -> NOT intercepted
    let toolbarPrevented = false;
    win.dispatchWindowEvent('contextmenu', {
      target: toolbar,
      clientX: 10,
      clientY: 10,
      preventDefault() { toolbarPrevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() {}
    });
    assert.equal(toolbarPrevented, false);

    // Clicking a segment right after a point -> right-click must NOT hijack segment
    win.dismissQuickRenamePopup();
    ggbApi.triggerClick('s');
    let segmentPrevented = false;
    win.dispatchWindowEvent('contextmenu', {
      target: canvas,
      clientX: 200,
      clientY: 200,
      preventDefault() { segmentPrevented = true; },
      stopPropagation() {},
      stopImmediatePropagation() {}
    });
    assert.equal(segmentPrevented, false);

    // Invalid GeoGebra name when renameObject returns false -> keeps popup open + shows inline error
    ggbApi.triggerSelect('A');
    win.dispatchWindowEvent('contextmenu', {
      target: canvas,
      clientX: 100,
      clientY: 120,
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {}
    });
    const input = popup.querySelector('#qr-input');
    const errEl = popup.querySelector('#qr-error');
    ggbApi.setRenameResult(false);
    input.value = '123';
    input.dispatchEvent({ type: 'keydown', key: 'Enter' });

    assert.equal(popup.style.display, 'block');
    assert.equal(input.classList.contains('is-error'), true);
    assert.equal(errEl.hidden, false);

    // Duplicate-name check preserves input.title and visible #qr-error
    ggbApi.setRenameResult(true);
    input.value = 'B';
    input.dispatchEvent({ type: 'input' });
    assert.equal(errEl.hidden, true);
    input.dispatchEvent({ type: 'keydown', key: 'Enter' });
    assert.equal(input.classList.contains('is-error'), true);
    assert.ok(input.getAttribute('title').includes('B'));
    assert.equal(errEl.hidden, false);

    // Stale point selection (> 600ms old) on canvas should NOT intercept contextmenu
    win.dismissQuickRenamePopup();
    const realDateNow = Date.now;
    let fakeNow = realDateNow();
    Date.now = () => fakeNow;
    try {
      ggbApi.triggerSelect('A');
      fakeNow += 700;
      let stalePrevented = false;
      win.dispatchWindowEvent('contextmenu', {
        target: canvas,
        clientX: 100,
        clientY: 120,
        preventDefault() { stalePrevented = true; },
        stopPropagation() {},
        stopImmediatePropagation() {}
      });
      assert.equal(stalePrevented, false);
    } finally {
      Date.now = realDateNow;
    }
  });
});
