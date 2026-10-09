// A small in-memory stand-in for the Apps Script services Code.gs uses, so the real backend code can run
// under Node for unit tests and behind a local HTTP server for the browser tests.
import { readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODE = path.join(HERE, '..', 'apps-script', 'Code.gs');

// formatting calls (fonts, colours, validation, widths) are no-ops: any method returns the same chainable object
const chain = () => {
  const p = new Proxy(function () {}, { get: (_, k) => (k === 'build' ? () => ({}) : () => p), apply: () => p });
  return p;
};

class Sheet {
  constructor(name) { this.name = name; this.cells = []; this.checkboxes = new Set(); }
  getName() { return this.name; }
  getLastRow() {
    for (let r = this.cells.length - 1; r >= 0; r--) if ((this.cells[r] || []).some((v) => v !== '' && v != null)) return r + 1;
    return 0;
  }
  appendRow(values) { this.cells[this.getLastRow()] = values.map(cellValue); return this; }
  getRange(a, b, c, d) {
    if (typeof a === 'string') return chain(); // A1 notation is only used for formatting
    return new Range(this, a, b, c || 1, d || 1);
  }
  // test helpers
  rows() { return this.cells.slice(1).filter(Boolean).map((r) => r.slice()); }
  set(row, col, v) { (this.cells[row - 1] ||= [])[col - 1] = cellValue(v); }
}

// mimic Sheets: a string starting with = is a formula (we record that to catch injection), a leading ' is dropped
function cellValue(v) {
  if (typeof v === 'string' && v.startsWith('=')) return { formula: v };
  if (typeof v === 'string' && v.startsWith("'")) return v.slice(1);
  return v;
}

class Range {
  constructor(sheet, row, col, nr, nc) { Object.assign(this, { sheet, row, col, nr, nc }); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.nr; r++) {
      const src = this.sheet.cells[this.row - 1 + r] || [];
      const line = [];
      for (let c = 0; c < this.nc; c++) {
        const v = src[this.col - 1 + c];
        line.push(v == null ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  setValues(vals) {
    vals.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  insertCheckboxes() { return this; }
}
// every other Range method is formatting
const rangeProxy = (r) => {
  const proxy = new Proxy(r, {
    get: (t, k) => {
      if (!(k in t)) return () => proxy;
      const v = t[k];
      return typeof v === 'function' ? (...a) => { const res = v.apply(t, a); return res === t ? proxy : res; } : v;
    },
  });
  return proxy;
};
const origGetRange = Sheet.prototype.getRange;
Sheet.prototype.getRange = function (...a) {
  const r = origGetRange.apply(this, a);
  return r instanceof Range ? rangeProxy(r) : r;
};

export function createGas({ now = () => Date.now() } = {}) {
  const sheets = new Map();
  const ss = {
    getSheetByName: (n) => (sheets.has(n) ? sheetProxy(sheets.get(n)) : null),
    insertSheet: (n) => { sheets.set(n, new Sheet(n)); return sheetProxy(sheets.get(n)); },
    getSheets: () => [...sheets.values()].map(sheetProxy),
  };
  const sheetProxy = (s) => new Proxy(s, { get: (t, k) => (k in t ? (typeof t[k] === 'function' ? t[k].bind(t) : t[k]) : () => sheetProxy(t)) });
  const cacheStore = new Map();
  const cache = {
    get: (k) => { const e = cacheStore.get(k); if (!e) return null; if (e.until < now()) { cacheStore.delete(k); return null; } return e.v; },
    put: (k, v, sec = 600) => { cacheStore.set(k, { v: String(v), until: now() + sec * 1000 }); },
    remove: (k) => cacheStore.delete(k),
  };
  const props = new Map();
  const alerts = [];
  const ctx = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      newDataValidation: chain,
      newConditionalFormatRule: chain,
      getUi: () => ({ createMenu: () => chain(), alert: (m) => alerts.push(m) }),
    },
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (props.has(k) ? props.get(k) : null), setProperty: (k, v) => props.set(k, String(v)) }) },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: (s) => ({ s, setMimeType() { return this; }, getContent() { return this.s; } }) },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Apps Script returns signed bytes
      computeDigest: (alg, s) => [...createHash(alg).update(String(s), 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    console,
    Date,
    JSON,
    Math,
  };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(CODE, 'utf8'), ctx, { filename: 'Code.gs' });
  const call = {
    get: (params = {}) => JSON.parse(ctx.doGet({ parameter: params }).getContent()),
    post: (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).getContent()),
  };
  return { ctx, ss, sheets, cache, props, alerts, call, sheet: (n) => sheets.get(n) };
}
