/*
  Ядро брифинга: рельеф, каталог объектов, сборка 3D-мира из сценария, маркеры, хранилище озвучки.
  Общее для плеера (index.html) и редактора (editor.html).

  Это обычный (не модульный) скрипт: так страницы открываются прямо с диска (file://),
  где браузер не грузит локальные ES-модули. three.js передаётся снаружи:
      const Core = BriefingCore(THREE);

  Рельеф = базовая карта высот (генерация + кисти) + модификаторы от объектов, по порядку:
    1) терраформинг — кратеры, шахты, холмы, плато, озёра, реки, русла, траншеи;
    2) площадки под зданиями — земля плавно подстраивается под основание.
  Модификаторы пересчитываются при каждом изменении, поэтому объект можно таскать — земля идёт следом.
*/
(function () {
'use strict';

window.BriefingCore = function (THREE) {

const DEG = Math.PI / 180;
const UNIT_M = 12;           // 1 юнит сцены = 12 м
const SIZE = 320;            // сторона карты в юнитах
const GRID = 161;            // узлов карты высот по стороне
const RMAX = 150;            // радиус рабочей области
const STORAGE_KEY = 'briefing.scenario.v1';

const COL = { bg:'#090a0b', ink:'#dfe2d8', hot:'#ff5a2c', dim:'#8a8d86', ally:'#7cc8ff', water:'#6fb8ff' };
const C = {}; for (const k in COL) C[k] = new THREE.Color(COL[k]);

const SIDES = {
  target:  { name:'Основная цель', col:'hot',  mk:'target'  },
  hostile: { name:'Противник',     col:'hot',  mk:'hot'     },
  neutral: { name:'Нейтральный',   col:'dim',  mk:'neutral' },
  ally:    { name:'Союзник',       col:'ally', mk:'ally'    },
  nav:     { name:'Навигация',     col:'ink',  mk:'nav'     },
};

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const uid = (p = 'o') => p + Math.random().toString(36).slice(2, 8);
const clone = o => JSON.parse(JSON.stringify(o));
const elv = y => String(Math.max(0, Math.round(y * UNIT_M + 1200))).padStart(4, '0');

/* =========================== шум =========================== */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function makeNoise(seed) {
  seed = seed | 0;
  const hash = (ix, iy) => { let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const v = (x, y) => { const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1); return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy; };
  const fbm = (x, y, o = 5) => { let s = 0, a = .5, f = 1; for (let i = 0; i < o; i++) { s += a * v(x * f + i * 17.3, y * f - i * 9.1); f *= 2.03; a *= .5; } return s; };
  const ridged = (x, y, o = 5) => { let s = 0, a = .5, f = 1, w = 1; for (let i = 0; i < o; i++) { let n = 1 - Math.abs(v(x * f + i * 31.7, y * f - i * 12.9) * 2 - 1); n *= n; n *= w; w = Math.min(1, n * 1.8); s += n * a; f *= 2.07; a *= .5; } return s; };
  return { v, fbm, ridged, rnd:mulberry32(seed * 7919 + 13) };
}
const EN = makeNoise(31);      // шум для неровных краёв модификаторов

/* =========================== пути =========================== */
function smoothPath(pts, step = 2) {
  if (!pts || pts.length < 2) return (pts || []).map(([x, z]) => ({ x, z }));
  const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  return c.getSpacedPoints(Math.max(8, Math.round(c.getLength() / step))).map(v => ({ x:v.x, z:v.z }));
}
/* Ближайшая точка ломаной с корзинами — быстро даже для длинных рек. */
function pathIndex(S, reach) {
  const B = 12, buckets = new Map(), key = (i, j) => i * 10007 + j;
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1];
    const i0 = Math.floor((Math.min(a.x, b.x) - reach) / B), i1 = Math.floor((Math.max(a.x, b.x) + reach) / B);
    const j0 = Math.floor((Math.min(a.z, b.z) - reach) / B), j1 = Math.floor((Math.max(a.z, b.z) + reach) / B);
    for (let p = i0; p <= i1; p++) for (let q = j0; q <= j1; q++) { const k = key(p, q); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(i); }
  }
  return (x, z) => {
    const list = buckets.get(key(Math.floor(x / B), Math.floor(z / B))); if (!list) return null;
    let best = 1e9, bi = -1, bt = 0;
    for (const i of list) { const a = S[i], b = S[i + 1], dx = b.x - a.x, dz = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z); if (d < best) { best = d; bi = i; bt = t; } }
    return { d:best, i:bi, t:bt };
  };
}

/* =========================== типы местности =========================== */
const TESSERA = { target:[22,-12], route:[[-22,118],[-38,92],[-30,62],[-8,40],[6,22],[16,2]], quarry:[72,58] };
const BIOMES = {
  plains:  { name:'Равнины', fn:(N, R) => (x, z) => ((N.fbm(x * .008 + 5, z * .008) - .5) * 18 + (N.fbm(x * .035, z * .035, 3) - .5) * 3) * R },
  hills:   { name:'Холмы', fn:(N, R) => (x, z) => ((N.fbm(x * .013 + 2, z * .013 - 4) - .45) * 40 + 5 * Math.abs(N.v(x * .05 + 9, z * .05) - .5)) * R },
  rocks:   { name:'Скалы', fn:(N, R) => (x, z) => { const r = N.ridged(x * .0095 + 3, z * .0095 - 7, 6); let h = (r * r * 1.3 - .22) * 62 + (N.fbm(x * .02, z * .02, 3) - .5) * 8;
             const t = Math.round(h / 5) * 5; h += (t - h) * .35 * ss(5, 25, h); return h * R; } },
  canyon:  { name:'Каньон', fn:(N, R) => { const ph = N.rnd() * 6.28, ph2 = N.rnd() * 6.28;
             return (x, z) => { const cx = Math.sin(z * .014 + ph) * 42 + (N.fbm(z * .01, 3.3, 3) - .5) * 50;
               const w = 12 + N.v(z * .02, 9) * 10; let t = ss(w + 16, w, Math.abs(x - cx));
               const cz = Math.sin(x * .02 + ph2) * 28 - 40, w2 = 8 + N.v(x * .03, 4) * 5;
               if (x > cx - 4) t = Math.max(t, ss(w2 + 12, w2, Math.abs(z - cz)) * ss(150, 110, x));
               t = t * .5 + Math.round(t * 4) / 4 * .5;
               const top = 26 + (N.fbm(x * .012, z * .012) - .5) * 16, floor = -16 + (N.fbm(x * .03, z * .03, 3) - .5) * 5;
               return (top * (1 - t) + floor * t) * R; }; } },
  mixed:   { name:'Равнины со скалами', fn:(N, R) => { const rocks = [];
             for (let i = 0; i < 18; i++) rocks.push({ x:(N.rnd() - .5) * 290, z:(N.rnd() - .5) * 290, r:6 + N.rnd() * 17, h:10 + N.rnd() * 24, s:3 + N.rnd() * 3 });
             return (x, z) => { let h = (N.fbm(x * .008, z * .008) - .5) * 12;
               for (const k of rocks) { const dx = x - k.x, dz = z - k.z; if (Math.abs(dx) > k.r * 1.6 || Math.abs(dz) > k.r * 1.6) continue;
                 const d = Math.hypot(dx, dz) * (1 + (N.v(x * .15 + k.x, z * .15) - .5) * .6); let m = k.h * ss(k.r, k.r * .62, d);
                 if (m > 0) { const q = Math.round(m / k.s) * k.s; m += (q - m) * .7; h += m; } }
               return h * R; }; } },
  dunes:   { name:'Дюны', fn:(N, R) => { const a = N.rnd() * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
             return (x, z) => { const u = (x * ca + z * sa) * .045 + (N.fbm(x * .01, z * .01) - .5) * 3.5, f = u - Math.floor(u);
               let p = f < .8 ? f / .8 : (1 - f) / .2; p = p * p * (3 - 2 * p);
               return (p * 9 * (.5 + .9 * N.fbm(x * .006, z * .006, 3)) + (N.fbm(x * .007 + 9, z * .007) - .5) * 16) * R; }; } },
  /* Кратеры ставятся объектами-модификаторами: их можно двигать, удалять, менять радиус и глубину. */
  craters: { name:'Кратеры', fn:(N, R) => (x, z) => (N.fbm(x * .01, z * .01) - .5) * 10 * R,
             spawn:(N, R) => { const out = [];
               for (let i = 0; i < 22; i++) { const r = Math.round(6 + Math.pow(N.rnd(), 2) * 40), a = N.rnd() * 6.283, d = Math.sqrt(N.rnd()) * 140;
                 out.push(Object.assign(makeObject('crater', Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)), { radius:r, depth:Math.round(r * .35 * R * 10) / 10, rim:.9, rough:.5, auto:'biome', name:`Кратер ${i + 1}` })); }
               return out; } },
  flat:    { name:'Пустая', fn:() => () => 0 },
  tessera: { name:'Тессера (демо)', fn:(N, R) => { const [tx, tz] = TESSERA.target, [qx, qz] = TESSERA.quarry;
             return (x, z) => {
               let h = (N.fbm(x * .011 + 3.1, z * .011 - 1.7) - .45) * 44 + 5 * Math.abs(N.v(x * .05 + 9, z * .05) - .5);
               const rz = z + 82; h += 30 * Math.exp(-(rz * rz) / (2 * 15 * 15)) * (.55 + .9 * N.v(x * .025, 7.3));
               const q = ss(34, 10, Math.hypot(x - qx, z - qz)); if (q > 0) { h -= q * 14; const t = Math.round(h / 3) * 3; h += (t - h) * q; }
               const p = ss(40, 20, Math.hypot(x - tx, z - tz)); h = h * (1 - p) + (17 + 1.2 * N.v(x * .12, z * .12)) * p;
               return h * R; }; } },
};

/* =========================== модификаторы рельефа =========================== */
const MODS = {
  crater(o) { const r = o.radius, R = r * 1.8;
    return { x0:o.x - R, x1:o.x + R, z0:o.z - R, z1:o.z + R, f(x, z, h) {
      let q = Math.hypot(x - o.x, z - o.z) / r; q *= 1 + (EN.v(x * .08 + o.x, z * .08 - o.z) - .5) * .3 * (o.rough ?? .5);
      let v = 0; if (q < 1) v -= o.depth * (1 - q * q); v += o.depth * (o.rim ?? .8) * .5 * Math.exp(-Math.pow((q - 1) / .2, 2)); return h + v; } }; },
  shaft(o) { const r = o.radius, R = r * 1.7 + 3; let top = 0;
    return { x0:o.x - R, x1:o.x + R, z0:o.z - R, z1:o.z + R, pre(hf) { top = hf.sample(o.x, o.z); }, f(x, z, h) {
      const q = Math.hypot(x - o.x, z - o.z) / r, w = ss(1, .8, q); let v = h + (top - o.depth - h) * w;
      return v + (o.collar || 0) * Math.exp(-Math.pow((q - 1.2) / .15, 2)); } }; },
  hill(o) { const r = o.radius;
    return { x0:o.x - r, x1:o.x + r, z0:o.z - r, z1:o.z + r, f(x, z, h) { const q = Math.hypot(x - o.x, z - o.z) / r; if (q >= 1) return h;
      return h + o.height * Math.pow(1 - q * q, 1 + (o.sharp ?? .3) * 3) * (.85 + .3 * EN.v(x * .06 + o.z, z * .06)); } }; },
  mesa(o) { const r = o.radius, R = r * 1.3; let top = 0;
    return { x0:o.x - R, x1:o.x + R, z0:o.z - R, z1:o.z + R, pre(hf) { top = hf.sample(o.x, o.z) + o.height; }, f(x, z, h) {
      const q = Math.hypot(x - o.x, z - o.z) / r * (1 + (EN.v(x * .07, z * .07 + o.x) - .5) * .35); let p = ss(1.15, .88, q); if (p <= 0) return h;
      const k = (o.terraces | 0) + 1; if (k > 1) { const t = Math.round(p * k) / k; p = p * .25 + t * .75; }
      return top > h ? h + (top - h) * p : h; } }; },
  lake(o) { const r = o.radius, R = r * 1.35; let bottom = 0, wl = 0;
    return { x0:o.x - R, x1:o.x + R, z0:o.z - R, z1:o.z + R, pre(hf) { wl = lakeLevel(hf, o); bottom = wl - o.depth; }, f(x, z, h) {
      const q = Math.hypot(x - o.x, z - o.z) / r * (1 + (EN.v(x * .09 + o.z, z * .09) - .5) * .25); if (q > 1.35) return h;
      const target = bottom + (wl + 1.5 - bottom) * Math.pow(Math.min(q, 1), 2.2), v = h + (target - h) * ss(1.35, 1, q); return Math.min(h, v); } }; },
  channel(o, monotone) {
    const S = smoothPath(o.pts, 2); if (S.length < 2) return null;
    const hw = o.width / 2, bank = Math.max(3, hw * .8), reach = hw + bank;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; S.forEach(p => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); });
    const near = pathIndex(S, reach); let bed = [];
    return { x0:x0 - reach, x1:x1 + reach, z0:z0 - reach, z1:z1 + reach,
      pre(hf) { bed = S.map(p => hf.sample(p.x, p.z) - o.depth);
        if (monotone) for (let i = 1; i < bed.length; i++) bed[i] = Math.max(Math.min(bed[i], bed[i - 1]), hf.sample(S[i].x, S[i].z) - o.depth * 2.5);   // вода течёт вниз, но русло не глубже 2,5 глубины
        for (let k = 0; k < 2; k++) bed = bed.map((b, i) => (bed[Math.max(0, i - 1)] + b * 2 + bed[Math.min(bed.length - 1, i + 1)]) / 4); },
      f(x, z, h) { const n = near(x, z); if (!n || n.d > reach) return h;
        const b = bed[n.i] + (bed[n.i + 1] - bed[n.i]) * n.t, target = b + o.depth * Math.pow(Math.min(1, n.d / reach), 1.6) * 1.15;
        return Math.min(h, h + (target - h) * ss(reach, hw * .7, n.d)); } };
  },
  pad(o, d) {
    const sc = o.scale || 1, fp = d.fp ? valOf(d.fp, o) : [valOf(d.r, o) * .75, valOf(d.r, o) * .75];
    const hx = fp[0] * sc, hz = fp[1] * sc, blend = Math.max(7, Math.max(hx, hz) * .9), rot = (o.rot || 0) * DEG, c = Math.cos(rot), s = Math.sin(rot);
    const R = Math.hypot(hx, hz) + blend * 1.4; let T = 0;
    return { x0:o.x - R, x1:o.x + R, z0:o.z - R, z1:o.z + R,
      pre(hf) { let sum = hf.sample(o.x, o.z) * 2, n = 2;          // высота площадки — средняя по основанию
        for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { const lx = a * hx, lz = b * hz; sum += hf.sample(o.x + lx * c + lz * s, o.z - lx * s + lz * c); n++; }
        T = sum / n; },
      f(x, z, h) { const dx = x - o.x, dz = z - o.z, lx = dx * c - dz * s, lz = dx * s + dz * c;
        const qx = Math.abs(lx) - hx, qz = Math.abs(lz) - hz, dist = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
        const dn = dist - (EN.v(x * .13 + o.x, z * .13) - .5) * blend * .6;           // неровный край — склон выглядит естественно
        return h + (T - h) * (1 - ss(0, blend, dn)); } };
  },
};
function lakeLevel(hf, o) { let m = 1e9; for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283; m = Math.min(m, hf.sample(o.x + Math.cos(a) * o.radius * 1.05, o.z + Math.sin(a) * o.radius * 1.05)); } return m - 1; }
function modOf(o) {
  const d = CATALOG[o.type]; if (!d) return null;
  if (d.terra === 'channel') return MODS.channel(o, !!d.monotone);
  if (d.terra) return MODS[d.terra](o);
  return null;
}
const hasPad = o => { const d = CATALOG[o.type]; return !!d && !d.kind && !d.terra && !d.path && d.pad !== false && o.ground !== false; };
const affectsTerrain = o => { const d = CATALOG[o.type]; return !!d && (!!d.terra || hasPad(o)); };

/* =========================== карта высот =========================== */
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(b) { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

class Heightfield {
  constructor(n = GRID, size = SIZE) { this.n = n; this.size = size; this.cell = size / (n - 1); this.base = new Float32Array(n * n); this.h = new Float32Array(n * n); }
  coord(i) { return -this.size / 2 + i * this.cell; }
  fillBase(f) { const n = this.n; for (let j = 0; j < n; j++) { const z = this.coord(j); for (let i = 0; i < n; i++) this.base[j * n + i] = f(this.coord(i), z); } this.h.set(this.base); }
  /* Генерация базы. Возвращает объекты, которые тип местности ставит сам (например, кратеры). */
  generate(biome, seed, relief = 1) { const B = BIOMES[biome] || BIOMES.plains, N = makeNoise(seed); this.fillBase(B.fn(N, relief)); return B.spawn ? B.spawn(N, relief) : []; }
  sample(x, z) {
    const n = this.n, c = this.cell; let fx = (x + this.size / 2) / c, fz = (z + this.size / 2) / c;
    fx = Math.max(0, Math.min(n - 1.0001, fx)); fz = Math.max(0, Math.min(n - 1.0001, fz));
    const i = fx | 0, j = fz | 0, tx = fx - i, tz = fz - j, h = this.h, k = j * n + i;
    return (h[k] * (1 - tx) + h[k + 1] * tx) * (1 - tz) + (h[k + n] * (1 - tx) + h[k + n + 1] * tx) * tz;
  }
  /* Итоговый рельеф: база + модификаторы объектов (сначала терраформинг, потом площадки). */
  compose(objects) {
    this.h.set(this.base);
    const mods = [];
    for (const o of objects || []) { const m = modOf(o); if (m) mods.push(m); }
    for (const o of objects || []) if (hasPad(o)) mods.push(MODS.pad(o, CATALOG[o.type]));
    for (const m of mods) this.apply(m);
  }
  apply(m) {
    if (m.pre) m.pre(this);
    const n = this.n, c = this.cell, half = this.size / 2, h = this.h;
    const i0 = Math.max(0, Math.floor((m.x0 + half) / c)), i1 = Math.min(n - 1, Math.ceil((m.x1 + half) / c));
    const j0 = Math.max(0, Math.floor((m.z0 + half) / c)), j1 = Math.min(n - 1, Math.ceil((m.z1 + half) / c));
    for (let j = j0; j <= j1; j++) { const z = this.coord(j); for (let i = i0; i <= i1; i++) { const k = j * n + i; h[k] = m.f(this.coord(i), z, h[k]); } }
  }
  /* Кисть правит базу. mode: raise | lower | smooth | flatten | rough. target — для flatten. */
  brush(x, z, r, s, mode, target, noise) {
    const n = this.n, c = this.cell, half = this.size / 2, b = this.base;
    const i0 = Math.max(1, Math.floor((x - r + half) / c)), i1 = Math.min(n - 2, Math.ceil((x + r + half) / c));
    const j0 = Math.max(1, Math.floor((z - r + half) / c)), j1 = Math.min(n - 2, Math.ceil((z + r + half) / c));
    const src = mode === 'smooth' ? b.slice() : null;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = this.coord(i), pz = this.coord(j), q = Math.hypot(px - x, pz - z) / r; if (q >= 1) continue;
      const w = (1 - q * q) * (1 - q * q), k = j * n + i;
      if (mode === 'raise') b[k] += w * s;
      else if (mode === 'lower') b[k] -= w * s;
      else if (mode === 'flatten') b[k] += (target - b[k]) * Math.min(1, w * s * .12);
      else if (mode === 'smooth') { const avg = (src[k - 1] + src[k + 1] + src[k - n] + src[k + n] + src[k - n - 1] + src[k - n + 1] + src[k + n - 1] + src[k + n + 1] + src[k] * 2) / 10; b[k] += (avg - b[k]) * Math.min(1, w * s * .25); }
      else if (mode === 'rough' && noise) b[k] += (noise.v(px * .35, pz * .35) - .5) * w * s * 1.6;
    }
  }
  sampleBase(x, z) { const h = this.h; this.h = this.base; const v = this.sample(x, z); this.h = h; return v; }
  encode() { const a = new Int16Array(this.base.length); for (let i = 0; i < a.length; i++) a[i] = Math.max(-32767, Math.min(32767, Math.round(this.base[i] * 100))); return toB64(new Uint8Array(a.buffer)); }
  decode(str) { const u = fromB64(str), a = new Int16Array(u.buffer, 0, u.byteLength >> 1); if (a.length !== this.base.length) return false; for (let i = 0; i < a.length; i++) this.base[i] = a[i] / 100; this.h.set(this.base); return true; }
}

/* =========================== материалы =========================== */
const TERRAIN_VS = `varying vec3 vW;varying vec3 vN;
void main(){vec4 w=modelMatrix*vec4(position,1.);vW=w.xyz;vN=normal;gl_Position=projectionMatrix*viewMatrix*w;}`;
const TERRAIN_FS = `uniform vec3 uLine;uniform vec3 uBg;uniform float uTime;uniform float uReveal;uniform vec3 uFocus;uniform vec2 uMask;uniform float uGain;
varying vec3 vW;varying vec3 vN;
float aa(float v,float w){float fw=max(fwidth(v),1e-4);float d=abs(fract(v-.5)-.5)/(fw*w);return 1.-clamp(d,0.,1.);}
void main(){
  float r=length(vW.xz);
  if(r>uReveal+1.5) discard;
  float mask=1.-smoothstep(uMask.x,uMask.y,r);
  float minor=aa(vW.y/2.4,1.);
  float major=aa(vW.y/12.,1.6);
  vec2 g=vW.xz/16.;
  float grid=max(aa(g.x,1.),aa(g.y,1.));
  float fd=length(vW.xz-uFocus.xy);
  float focus=1.-smoothstep(uFocus.z*.45,uFocus.z,fd);
  float sr=mod(uTime*48.,520.)-90.;
  float scan=exp(-pow((r-sr)/3.,2.));
  float sh=clamp(dot(normalize(vN),normalize(vec3(-.5,.8,.25))),0.,1.);
  vec3 col=uBg+vec3(.0035)*sh;
  float L=minor*.17+major*.5+grid*.04;
  L*=.36+.85*focus;
  L+=scan*(.05+minor*.45+major*.35);
  col+=uLine*L*uGain;
  col+=uLine*exp(-pow((r-uReveal)/1.8,2.))*1.4;
  gl_FragColor=vec4(mix(uBg,col,mask),1.);
}`;
function makeTerrain(hf, time, opt = {}) {
  const geo = new THREE.PlaneGeometry(hf.size, hf.size, hf.n - 1, hf.n - 1).rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms:{ uLine:{ value:C.ink }, uBg:{ value:C.bg }, uTime:time, uReveal:{ value:opt.reveal ?? 1e4 },
      uFocus:{ value:new THREE.Vector3(0, 0, 1e4) }, uMask:{ value:new THREE.Vector2(...(opt.mask || [125, 156])) }, uGain:{ value:opt.gain ?? 1 } },
    vertexShader:TERRAIN_VS, fragmentShader:TERRAIN_FS,
  });
  const mesh = new THREE.Mesh(geo, mat);
  const t = { mesh, mat, geo, sync() { const p = geo.attributes.position.array; for (let i = 0; i < hf.h.length; i++) p[i * 3 + 1] = hf.h[i];
    geo.attributes.position.needsUpdate = true; geo.computeVertexNormals(); geo.computeBoundingSphere(); } };
  t.sync(); return t;
}

const DASH_VS = `attribute float ld;varying float vD;void main(){vD=ld;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
const DASH_FS = `uniform vec3 uColor;uniform float uOp;uniform float uTime;uniform float uDash;uniform float uGap;uniform float uSpeed;uniform float uProg;varying float vD;
void main(){if(vD>uProg)discard;if(uDash>0.){float f=fract((vD-uTime*uSpeed)/uDash);if(f>1.-uGap)discard;}gl_FragColor=vec4(uColor,uOp);}`;
function dashMat(color, time, o = {}) {
  const m = new THREE.ShaderMaterial({ uniforms:{ uColor:{ value:color.clone() }, uOp:{ value:0 }, uTime:time, uDash:{ value:o.dash || 0 }, uGap:{ value:o.gap ?? .5 },
    uSpeed:{ value:o.speed || 0 }, uProg:{ value:1e9 } }, vertexShader:DASH_VS, fragmentShader:DASH_FS, transparent:true, depthWrite:false });
  m.userData.base = o.op ?? 1; return m;
}
function lineMat(color, op = 1) { const m = new THREE.LineBasicMaterial({ color:color.clone(), transparent:true, opacity:0, depthWrite:false }); m.userData.base = op; return m; }
const setOp = (m, v) => { if (m.uniforms && m.uniforms.uOp) m.uniforms.uOp.value = v; else m.opacity = v; };
function lineGeo(pts) {
  const pos = new Float32Array(pts.length * 3), ld = new Float32Array(pts.length); let acc = 0;
  pts.forEach((p, i) => { pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; if (i) acc += p.distanceTo(pts[i - 1]); ld[i] = acc; });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('ld', new THREE.BufferAttribute(ld, 1)); g.userData.len = acc; return g;
}
/* Оболочка силового поля: френель по краю + бегущие полосы. */
const SHELL_VS = `varying vec3 vN;varying vec3 vV;varying float vY;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);vY=position.y;gl_Position=projectionMatrix*mv;}`;
const SHELL_FS = `uniform vec3 uColor;uniform float uOp;uniform float uTime;uniform float uR;varying vec3 vN;varying vec3 vV;varying float vY;
void main(){float f=1.-abs(dot(normalize(vN),normalize(vV)));float rim=pow(f,2.);
  float band=1.-smoothstep(.0,.06,abs(fract(vY/uR*5.-uTime*.35)-.5));
  float hex=1.-smoothstep(.0,.08,abs(fract(vY/uR*22.)-.5));
  float a=(.1+rim*.6+band*.15+hex*.04)*uOp;gl_FragColor=vec4(uColor,a);}`;
function shellMat(color, time, r) {
  const m = new THREE.ShaderMaterial({ uniforms:{ uColor:{ value:color.clone() }, uOp:{ value:0 }, uTime:time, uR:{ value:r } }, vertexShader:SHELL_VS, fragmentShader:SHELL_FS,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide });
  m.userData.base = 1; return m;
}

/* =========================== конструктор моделей =========================== */
class Builder {
  constructor(e, fill) { this.e = e; this.fill = fill; this.p = e.body; this.W = e.W; this.o = e.o; }
  into(g, fn) { const prev = this.p; this.p = g; fn(); this.p = prev; return g; }
  group(x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); this.p.add(g); return g; }
  add(geo, x, y, z, rx = 0, ry = 0, rz = 0, o = {}) {
    const l = new THREE.LineSegments(o.wire ? new THREE.WireframeGeometry(geo) : new THREE.EdgesGeometry(geo, 15), this.e.mat);
    l.position.set(x, y, z); l.rotation.set(rx, ry, rz); this.p.add(l);
    if (!o.wire && o.fill !== false) { const m = new THREE.Mesh(geo, this.fill); m.position.copy(l.position); m.rotation.copy(l.rotation); this.p.add(m); this.e.fills.push(m); }
    else geo.dispose();
    return l;
  }
  box(w, h, d, x = 0, y = 0, z = 0, ry = 0, o) { return this.add(new THREE.BoxGeometry(w, h, d), x, y + h / 2, z, 0, ry, 0, o); }
  tilt(w, h, d, x, y, z, rx, ry, rz, o) { return this.add(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz, o); }
  cyl(rt, rb, h, seg, x = 0, y = 0, z = 0, o = {}) { return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, o.hs || 1, !!o.open), x, y + (o.center ? 0 : h / 2), z, o.rx || 0, o.ry || 0, o.rz || 0, o); }
  oct(r, x, y, z) { return this.add(new THREE.OctahedronGeometry(r), x, y, z, 0, 0, 0, { fill:false }); }
  lattice(rt, rb, h, x = 0, y = 0, z = 0, segs = 7) { return this.add(new THREE.CylinderGeometry(rt, rb, h, 4, segs, true), x, y + h / 2, z, 0, Math.PI / 4, 0, { wire:true }); }
  poly(pts, closed) { const v = pts.map(p => new THREE.Vector3(p[0], p[1], p[2])); if (closed) v.push(v[0].clone());
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(v), this.e.mat); this.p.add(l); return l; }
  segs(arr) { if (!arr.length) return null; const v = []; arr.forEach(s => v.push(new THREE.Vector3(s[0], s[1], s[2]), new THREE.Vector3(s[3], s[4], s[5])));
    const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(v), this.e.mat); this.p.add(l); return l; }
  /* Высота земли в локальной точке (с учётом поворота и масштаба) относительно основания объекта. */
  groundAt(lx, lz) { const o = this.o, r = (o.rot || 0) * DEG, sc = o.scale || 1, c = Math.cos(r), s = Math.sin(r);
    const x = o.x + (lx * c + lz * s) * sc, z = o.z + (-lx * s + lz * c) * sc; return (this.W.hf.sample(x, z) - this.W.hf.sample(o.x, o.z)) / sc; }
}

/* Линии поверх рельефа в мировых координатах. Слой: mark — после «отметки», show — вместе с объектом, editor — только в редакторе. */
class Extras {
  constructor(W, e) { this.W = W; this.e = e; }
  mat(o = {}) {
    const color = o.color || this.e.col;
    const m = o.dash !== undefined || o.shader ? dashMat(color, this.W.time, o) : lineMat(color, o.op ?? .8);
    (o.layer === 'show' ? this.e.smats : o.layer === 'editor' ? this.e.emats : this.e.xmats).push(m); return m;
  }
  line(pts, o = {}) { if (o.layer === 'editor' && !this.W.opt.editor) return null; const l = new THREE.Line(lineGeo(pts), this.mat(o)); this.e.extras.add(l); return l; }
  loop(cx, cz, r, o = {}) { return this.line(this.W.loopPts(cx, cz, r, Math.max(28, Math.min(360, Math.round(r * 3))), o.lift ?? 1), o); }
  seg(x0, z0, x1, z1, o = {}) { const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2)), a = [];
    for (let i = 0; i <= n; i++) { const t = i / n; a.push(this.W.onT(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, o.lift ?? 1)); } return this.line(a, o); }
  path(pts, closed, o = {}) { if (pts.length < 2) return null; const P = closed ? [...pts, pts[0]] : pts, a = [];
    for (let i = 0; i < P.length - 1; i++) { const [x0, z0] = P[i], [x1, z1] = P[i + 1], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2));
      for (let k = (i ? 1 : 0); k <= n; k++) { const t = k / n; a.push(this.W.onT(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, o.lift ?? 1.2)); } }
    return this.line(a, o); }
  fan(cx, cz, hd, arc, R) {
    if (arc >= 359 * DEG) { this.loop(cx, cz, R, { op:.75 }); return; }
    const a0 = hd - arc / 2, a1 = hd + arc / 2, at = a => [cx + Math.sin(a) * R, cz + Math.cos(a) * R];
    const out = [], n = Math.max(12, Math.round(arc * R / 2.5));
    for (let i = 0; i <= n; i++) { const [x, z] = at(a0 + (a1 - a0) * i / n); out.push(this.W.onT(x, z, 1)); }
    this.seg(cx, cz, ...at(a0), { op:.75 }); this.line(out, { op:.75 }); this.seg(...at(a1), cx, cz, { op:.75 });
    const hm = this.mat({ op:.16 });
    for (let a = a0 + .17; a < a1 - .05; a += .17) { const [x, z] = at(a), seg = []; const n2 = Math.ceil(R / 2);
      for (let k = 0; k <= n2; k++) { const t = .15 + .85 * k / n2; seg.push(this.W.onT(cx + (x - cx) * t, cz + (z - cz) * t, 1)); }
      this.e.extras.add(new THREE.Line(lineGeo(seg), hm)); }
  }
  beam(x, y, z, h, o = {}) { const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + h, z)]), this.mat(o)); this.e.extras.add(l); return l; }
  pulse(x, y, z) { const m = lineMat(this.e.col, 1); this.e.pulseMat = m;
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length:97 }, (_, i) => { const t = i / 96 * Math.PI * 2; return new THREE.Vector3(Math.cos(t), 0, Math.sin(t)); })), m);
    l.position.set(x, y, z); this.e.extras.add(l); this.e.pulse = l; }
  route(ctrl) {
    if (ctrl.length < 2) { if (ctrl.length) this.loop(ctrl[0][0], ctrl[0][1], 3, { dash:1.5, gap:.5 }); return; }
    const pts = smoothPath(ctrl, 1.1).map(p => this.W.onT(p.x, p.z, 1.6));
    const l = this.line(pts, { dash:3.2, gap:.42, speed:7 });
    this.e.routeMat = l.material; this.e.routePts = pts; this.e.routeLd = l.geometry.attributes.ld.array; this.e.routeLen = l.geometry.userData.len;
    const end = ctrl[ctrl.length - 1]; this.loop(end[0], end[1], 3.5, { dash:1.4, gap:.5, speed:1 });
  }
  /* Течение: параллельные бегущие штрихи по уровню воды. */
  water(o, depthK) {
    const S = smoothPath(o.pts, 2); if (S.length < 2) return;
    const hw = o.width / 2;
    for (const k of [-.34, -.12, .12, .34]) {
      const pts = S.map((p, i) => { const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        const x = p.x - dz / L * hw * k, z = p.z + dx / L * hw * k; return new THREE.Vector3(x, this.W.hf.sample(p.x, p.z) + o.depth * depthK, z); });
      this.line(pts, { dash:4 + Math.abs(k) * 6, gap:.5, speed:5 - Math.abs(k) * 4, op:.55, color:C.water, layer:'show' });
    }
  }
  /* Озеро: штриховка зеркала воды. */
  lakeSurface(o) {
    const wl = lakeLevel(this.W.hf, o) + .3, r = o.radius * 1.3, segs = [];
    for (let z = o.z - r; z <= o.z + r; z += 2.6) { let run = null;
      for (let x = o.x - r; x <= o.x + r + 1; x += 1) { const wet = x <= o.x + r && this.W.hf.sample(x, z) < wl - .15;
        if (wet && !run) run = [x]; else if (!wet && run) { if (x - 1 - run[0] > 1.5) segs.push([run[0], x - 1, z]); run = null; } } }
    segs.forEach(([a, b, z]) => this.line([new THREE.Vector3(a, wl, z), new THREE.Vector3(b, wl, z)], { dash:3, gap:.45, speed:1.2, op:.5, color:C.water, layer:'show' }));
  }
}

/* =========================== каталог =========================== */
const CATS = [
  { id:'build',   name:'Здания' },
  { id:'special', name:'Особые объекты' },
  { id:'defense', name:'Оборона' },
  { id:'squad',   name:'Отряды' },
  { id:'terra',   name:'Рельеф' },
  { id:'nav',     name:'Навигация' },
];
/* Описания редактируемых параметров для инспектора (у типа можно переопределить в def.pui). */
const P = {
  range:   { label:'Радиус огня', type:'range', min:10, max:160, step:1, unit:'r' },
  arc:     { label:'Сектор обстрела', type:'range', min:20, max:360, step:5, unit:'°' },
  radius:  { label:'Радиус', type:'range', min:5, max:150, step:1, unit:'r' },
  length:  { label:'Длина', type:'range', min:8, max:90, step:1, unit:'r' },
  width:   { label:'Ширина', type:'range', min:3, max:40, step:.5, unit:'r' },
  depth:   { label:'Глубина', type:'range', min:1, max:40, step:.5, unit:'r' },
  height:  { label:'Высота', type:'range', min:2, max:60, step:.5, unit:'r' },
  rim:     { label:'Вал по краю', type:'range', min:0, max:1.5, step:.05, unit:'%' },
  rough:   { label:'Неровность края', type:'range', min:0, max:1, step:.05, unit:'%' },
  collar:  { label:'Бортик', type:'range', min:0, max:4, step:.1, unit:'r' },
  sharp:   { label:'Острота вершины', type:'range', min:0, max:1, step:.05, unit:'%' },
  terraces:{ label:'Террасы на склонах', type:'int', min:0, max:6 },
  count:   { label:'Численность', type:'int', min:1, max:10 },
  speed:   { label:'Скорость', type:'range', min:0, max:12, step:.1, unit:'s' },
  loop:    { label:'Замкнутый маршрут', type:'bool' },
  draw:    { label:'Прорисовка при показе', type:'bool' },
  color:   { label:'Цвет поля', type:'select', options:[['grey', 'Серый'], ['red', 'Красный'], ['green', 'Зелёный']] },
  model:   { label:'Модель', type:'select', options:[['mech', 'Мех'], ['human', 'Человек'], ['sphere', 'Шар'], ['cube', 'Куб']] },
  glitch:  { label:'Сила помех', type:'range', min:0, max:1, step:.05, unit:'%' },
};
const DOME_COLORS = { grey:'#c9ccc4', red:'#ff4a3a', green:'#59f28a' };
const ICON = {
  bunker:'<path d="M5 22h22v-6H5zM9 16v-4h14v4M13 19h6"/>',
  hangar:'<path d="M4 25V15a12 9 0 0 1 24 0v10zM11 25v-6h10v6"/>',
  cmd:'<path d="M4 25V15h16v10zM12 15v-5h10v15M24 10V4M8 15V8"/>',
  habitat:'<rect x="4" y="9" width="24" height="6" rx="3"/><rect x="4" y="18" width="24" height="6" rx="3"/>',
  silo:'<path d="M6 26V10l4-3 4 3v16M18 26V10l4-3 4 3v16M14 13h4"/>',
  tower:'<path d="M12 28 16 4l4 24M13.5 19h5M14.5 12h3M12 28l6-9M20 28l-6-9"/>',
  radar:'<path d="M10 28h12M16 28V18M7 9a11 11 0 0 0 14 9zM14 13l5-5"/>',
  pad:'<path d="M16 4 27 10v12L16 28 5 22V10zM12 11v10M20 11v10M12 16h8"/>',
  wall:'<path d="M3 24h26v-9H3zM3 15v-3h4v3M10 15v-3h4v3M17 15v-3h4v3M24 15v-3h5v3"/>',
  crates:'<path d="M3 26h12v-7H3zM15 26h14v-7H15zM8 19v-7h12v7M11 12V8h8v4"/>',
  factory:'<path d="M3 27V15l6 4v-4l6 4v-4l6 4V6h4v21zM8 23h3M14 23h3"/>',
  barracks:'<path d="M3 26V16l7-5 7 5v10zM15 26V16l7-5 7 5v10M8 26v-5h4v5"/>',
  bridge:'<path d="M2 14h28M2 18h28M6 18v9M16 18v9M26 18v9M2 14l6-6M30 14l-6-6"/>',
  solar:'<path d="M3 22l5-8h9l-5 8zM15 22l5-8h9l-5 8zM8 22v5M20 22v5M6 18h9M18 18h9"/>',
  fuel:'<rect x="3" y="10" width="18" height="7" rx="3.5"/><rect x="3" y="19" width="18" height="7" rx="3.5"/><path d="M24 26V12h4v14M26 12V8"/>',
  pipeline:'<path d="M3 12c6 0 6 8 13 8s7-8 13-8M3 15c6 0 6 8 13 8s7-8 13-8M8 18v9M16 22v5M24 18v9"/>',
  relay:'<path d="M16 4v22M12 26l4-14 4 14M9 26h14M10 8a8 8 0 0 1 12 0M12.5 11a4.5 4.5 0 0 1 7 0"/>',
  reactor:'<path d="M5 26V16l4-5h14l4 5v10zM11 11V7h10v4M16 16v6"/><circle cx="16" cy="19" r="3"/>',
  dome:'<path d="M3 25a13 13 0 0 1 26 0zM9 25a7 13 0 0 1 14 0M16 12v13M5 19h22"/>',
  wreck:'<path d="M3 21 20 13l9 3-6 7-18 3zM20 13l-2-6 6 2M12 25l2 3M25 22l3 3"/>',
  beacon:'<path d="M16 28V12M13 28h6M16 4l4 4-4 4-4-4zM7 5a12 12 0 0 0 0 6M25 5a12 12 0 0 1 0 6"/>',
  drill:'<path d="M11 28 16 3l5 25M12.5 20h7M14 12h4M8 28h16M16 28v-3"/>',
  artifact:'<path d="M13 28V10l3-6 3 6v18zM6 16a10 4 0 0 0 20 0M6 16a10 4 0 0 1 20 0"/>',
  mechwreck:'<path d="M4 26l8-3 3-7 7 2-2 6zM22 18l6-4M10 27l-4 2M18 12l3-4 3 2"/>',
  launch:'<path d="M16 3l3 7v12h-6V10zM13 22l-3 4h12l-3-4M6 28h20M24 28V8h2v20"/>',
  array:'<path d="M5 14a4 4 0 0 1 8 0zM19 14a4 4 0 0 1 8 0zM5 25a4 4 0 0 1 8 0zM19 25a4 4 0 0 1 8 0zM9 14v3M23 14v3M9 25v3M23 25v3"/>',
  turret:'<path d="M6 26h20v-6H6zM11 20v-4h10v4M18 17h10"/>',
  artillery:'<path d="M5 26h22v-5H5zM10 21v-4h10v4M17 17 28 7"/>',
  sam:'<path d="M4 26h24v-5H4zM8 21l10-12 5 4-10 8M12 17l8-6"/>',
  minefield:'<circle cx="16" cy="16" r="12" stroke-dasharray="3 3"/><path d="M9 10l3 3M12 10l-3 3M19 9l3 3M22 9l-3 3M13 19l3 3M16 19l-3 3M21 18l3 3M24 18l-3 3"/>',
  watchtower:'<path d="M10 28l3-14h6l3 14M11 14h10v-5H11zM9 9h14M12 21h8"/>',
  trench:'<path d="M3 13c5 3 8-3 13 0s8 3 13 0M3 19c5 3 8-3 13 0s8 3 13 0"/><path d="M5 16h2M11 16h2M17 16h2M23 16h2"/>',
  barricade:'<path d="M3 26l6-10M3 16l6 10M12 26l6-10M12 16l6 10M21 26l6-10M21 16l6 10M2 21h28"/>',
  infantry:'<path d="M8 26l3-11 3 11M18 26l3-11 3 11"/><circle cx="11" cy="11" r="2"/><circle cx="21" cy="11" r="2"/>',
  mech:'<path d="M10 28v-8M22 28v-8M8 20h16v-8H8zM12 12V8h8v4M24 15h5"/>',
  armor:'<path d="M3 24h26l-3-6H6zM10 18v-4h10v4M20 15h9"/>',
  drones:'<path d="M16 12l4 4-4 4-4-4zM6 8h6M20 8h6M6 24h6M20 24h6M9 8l4 6M23 8l-4 6M9 24l4-6M23 24l-4-6"/>',
  gunship:'<path d="M4 17h16l6-3v6l-6-3M10 17v-4M3 12h14M20 17l4 6"/>',
  wild:'<path d="M9 27v-7M19 27v-5M7 20h12v-7H7zM10 13V9h6v4"/><path d="M21 9h6M23 13h5M20 17h8M22 22h4" stroke-dasharray="2 1.5"/>',
  crater:'<ellipse cx="16" cy="18" rx="13" ry="6"/><ellipse cx="16" cy="19" rx="8" ry="3"/><path d="M3 18c1-4 5-6 13-6s12 2 13 6"/>',
  shaft:'<ellipse cx="16" cy="9" rx="7" ry="3"/><path d="M9 9v17M23 9v17M9 26c2 1 12 1 14 0M12 14v8M20 14v8"/>',
  hill:'<path d="M2 26c5-1 7-14 14-14s9 13 14 14M8 22c3-2 5-5 8-5s5 3 8 5"/>',
  mesa:'<path d="M2 26l6-4 3-10h10l3 10 6 4M8 22h16M11 12h10"/>',
  lake:'<path d="M4 18c0-6 6-9 12-9s12 3 12 9-6 7-12 7-12-1-12-7z"/><path d="M9 16h6M17 19h7M11 22h5" stroke-dasharray="2 1.5"/>',
  river:'<path d="M8 3c-4 6 6 9 2 15s4 8 2 12M18 3c-4 6 6 9 2 15s4 8 2 12"/><path d="M13 9h2M14 18h2M14 25h2"/>',
  dryriver:'<path d="M8 3c-4 6 6 9 2 15s4 8 2 12M18 3c-4 6 6 9 2 15s4 8 2 12" stroke-dasharray="3 2"/>',
  lz:'<path d="M16 4 26 10v12L16 28 6 22V10zM12 12l4 4 4-4M12 17l4 4 4-4"/>',
  extract:'<path d="M16 4 26 10v12L16 28 6 22V10zM12 16l4-4 4 4M12 21l4-4 4 4"/>',
  waypoint:'<path d="M16 28V12M16 3l5 5-5 5-5-5z"/><ellipse cx="16" cy="27" rx="7" ry="2"/>',
  zone:'<circle cx="16" cy="16" r="12" stroke-dasharray="4 3"/><path d="M16 12v8M12 16h8"/>',
  route:'<path d="M5 27c4-2 2-8 8-9s3-7 9-8 4-4 6-6" stroke-dasharray="3 2"/><circle cx="5" cy="27" r="1.5"/>',
};
const hexPts = (r, y) => Array.from({ length:6 }, (_, i) => [Math.cos(i / 6 * 6.283) * r, y, Math.sin(i / 6 * 6.283) * r]);
const editorRing = (X, o, r) => X.loop(o.x, o.z, r, { dash:2, gap:.5, op:.35, color:C.ink, layer:'editor' });

const CATALOG = {
  /* --- здания --- */
  bunker:  { cat:'build', name:'Бункер', desc:'Укреплённая огневая позиция', side:'neutral', tag:'Сооружение', r:8, top:6, fp:[6, 4.5],
    build(B) { B.box(12, 3.5, 9); B.box(8, 1.4, 6, 0, 3.5, 0); B.box(5, .7, .5, 0, 2, 4.6, 0, { fill:false }); } },
  hangar:  { cat:'build', name:'Ангар', desc:'Арочный ангар для техники', side:'neutral', tag:'Сооружение', r:14, top:11, fp:[9, 12],
    build(B) { B.box(18, 5, 24);
      for (const z of [-12, -6, 0, 6, 12]) B.poly(Array.from({ length:11 }, (_, i) => { const t = i / 10 * Math.PI; return [Math.cos(t) * 9, 5 + Math.sin(t) * 5, z]; }));
      B.segs([.5, 1.05, 1.57, 2.1, 2.65].map(t => [Math.cos(t) * 9, 5 + Math.sin(t) * 5, -12, Math.cos(t) * 9, 5 + Math.sin(t) * 5, 12]));
      B.poly([[-5, 0, 12.05], [-5, 4, 12.05], [5, 4, 12.05], [5, 0, 12.05]]); } },
  cmd:     { cat:'build', name:'Командный пункт', desc:'Штаб с антеннами связи', side:'neutral', tag:'Сооружение', r:9, top:13, fp:[7, 5],
    build(B) { B.box(14, 4, 10); B.box(7, 3.2, 6, 2, 4, -1); B.segs([[-4, 4, 2, -4, 12, 2], [5, 7.2, -2, 5, 13, -2], [-5.5, 10, 2, -2.5, 10, 2]]); } },
  barracks:{ cat:'build', name:'Казарма', desc:'Два жилых корпуса с двускатной крышей', side:'neutral', tag:'Сооружение', r:11, top:7, fp:[9, 9],
    build(B) { for (const z of [-4.5, 4.5]) { B.box(18, 3.5, 6, 0, 0, z); B.segs([[-9, 3.5, z - 3, -9, 5.5, z, ], [-9, 5.5, z, -9, 3.5, z + 3], [9, 3.5, z - 3, 9, 5.5, z], [9, 5.5, z, 9, 3.5, z + 3], [-9, 5.5, z, 9, 5.5, z]]); } } },
  habitat: { cat:'build', name:'Жилой модуль', desc:'Сдвоенные цилиндрические модули', side:'neutral', tag:'Сооружение', r:9, top:8, fp:[7, 8],
    build(B) { B.cyl(3.5, 3.5, 14, 8, 0, 3.5, -5, { rz:Math.PI / 2, center:true }); B.cyl(3.5, 3.5, 14, 8, 0, 3.5, 5, { rz:Math.PI / 2, center:true }); B.box(3, 3, 3, 0, 1, 0); } },
  factory: { cat:'build', name:'Завод', desc:'Цех с пилообразной крышей и трубами', side:'neutral', tag:'Промышленность', r:15, top:18, fp:[13, 9],
    build(B) { B.box(26, 6, 18);
      for (let x = -13; x < 13; x += 6.5) B.poly([[x, 6, -9], [x + 6.5, 9, -9], [x + 6.5, 6, -9]]), B.segs([[x + 6.5, 9, -9, x + 6.5, 9, 9], [x, 6, 9, x + 6.5, 9, 9]]);
      B.cyl(1.2, 1.6, 12, 8, 9, 6, 5); B.cyl(1, 1.4, 10, 8, 5, 6, 5); } },
  silo:    { cat:'build', name:'Резервуары', desc:'Топливные или рудные ёмкости', side:'neutral', tag:'Сооружение', r:9, top:14, fp:[8, 4],
    build(B) { for (const x of [-4.2, 4.2]) { B.cyl(3.5, 3.5, 11, 10, x, 0, 0); B.cyl(0, 3.5, 2, 10, x, 11, 0); } B.box(8.4, .6, .6, 0, 9.5, 0, 0, { fill:false }); } },
  fuel:    { cat:'build', name:'Топливная станция', desc:'Горизонтальные цистерны и колонка', side:'neutral', tag:'Сооружение', r:9, top:7, fp:[8, 6],
    build(B) { B.cyl(2.2, 2.2, 13, 10, -1, 2.6, -3, { rz:Math.PI / 2, center:true }); B.cyl(2.2, 2.2, 13, 10, -1, 2.6, 3, { rz:Math.PI / 2, center:true });
      B.box(2, 3, 2, 7.5, 0, 0); B.segs([[-6, .4, -3, -6, .4, 3], [4, .4, -3, 4, .4, 3]]); } },
  solar:   { cat:'build', name:'Солнечная ферма', desc:'Наклонные панели рядами', side:'neutral', tag:'Энергетика', r:12, top:4, fp:[11, 10],
    build(B) { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 2; j++) { const x = i * 7.5, z = j * 5.5 - 2.5; B.tilt(6.5, .25, 3.6, x, 2.2, z, -.45, 0, 0); B.segs([[x, 0, z, x, 1.8, z]]); } } },
  tower:   { cat:'build', name:'Радиомачта', desc:'Решётчатая вышка', side:'neutral', tag:'Сооружение', r:4, top:28,
    build(B) { B.lattice(.7, 2.4, 28); } },
  radar:   { cat:'build', name:'Радар', desc:'Вращающаяся антенна обзора', side:'neutral', tag:'Сооружение', r:5, top:13,
    build(B) { B.box(6, 3, 6); B.cyl(.5, .5, 6, 6, 0, 3, 0); const g = B.group(0, 9.5, 0); g.userData.spd = .8; B.e.spin.push(g);
      B.into(g, () => { B.cyl(5, 1, 2, 12, 0, 0, 0, { open:true, rx:1.0, center:true }); }); } },
  pad:     { cat:'build', name:'Посадочная площадка', desc:'Шестигранная площадка для шаттлов', side:'neutral', tag:'Сооружение', r:11, top:3, fp:[9, 9],
    build(B) { B.cyl(10, 10, .6, 6); B.segs([[-3, .7, -3, -3, .7, 3], [3, .7, -3, 3, .7, 3], [-3, .7, 0, 3, .7, 0]]); } },
  wall:    { cat:'build', name:'Стена', desc:'Сегмент укрепления, длина настраивается', side:'neutral', tag:'Укрепление', r:o => o.length / 2, top:7, params:{ length:30 }, fp:o => [o.length / 2, 1.5],
    build(B, o) { const L = o.length; B.box(L, 5, 2); for (let x = -L / 2 + 1.2; x < L / 2 - 1; x += 4) B.box(1.6, 1.2, 2, x, 5, 0, 0, { fill:false }); } },
  bridge:  { cat:'build', name:'Мост', desc:'Пролёт с опорами — над руслом или ущельем', side:'neutral', tag:'Сооружение', r:o => o.length / 2, top:6, pad:false, params:{ length:40, width:7 },
    pui:{ width:{ min:4, max:16, label:'Ширина моста' } },
    build(B, o) { const L = o.length, W2 = o.width / 2, g1 = B.groundAt(-L / 2, 0), g2 = B.groundAt(L / 2, 0); let top = Math.max(g1, g2, 0);
      for (let x = -L / 2; x <= L / 2; x += 2) top = Math.max(top, B.groundAt(x, 0) + 2);
      const y = top + 1.5; B.tilt(L, 1, o.width, 0, y, 0, 0, 0, 0);
      B.segs([[-L / 2, y + .5, -W2, L / 2, y + .5, -W2], [-L / 2, y + 1.8, -W2, L / 2, y + 1.8, -W2], [-L / 2, y + .5, W2, L / 2, y + .5, W2], [-L / 2, y + 1.8, W2, L / 2, y + 1.8, W2]]);
      B.segs([[-L / 2, g1, 0, -L / 2, y - .5, 0], [L / 2, g2, 0, L / 2, y - .5, 0]]);
      const n = Math.max(1, Math.round(L / 13)); for (let i = 1; i < n; i++) { const x = -L / 2 + L * i / n, g = B.groundAt(x, 0);
        if (y - .5 - g > 1.5) { B.segs([[x, g, -W2 + .6, x, y - .5, -W2 + .6], [x, g, W2 - .6, x, y - .5, W2 - .6], [x, y - 2.5, -W2 + .6, x, y - 2.5, W2 - .6]]); } } } },
  pipeline:{ cat:'build', path:true, name:'Трубопровод', desc:'Труба на опорах вдоль точек', side:'neutral', tag:'Инфраструктура', r:3, top:4, params:{ pts:[] },
    build(B, o) { const S = smoothPath(o.pts, 2), hf = B.W.hf; if (S.length < 2) return;
      for (const off of [-.5, .5]) B.poly(S.map((p, i) => { const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        return [p.x - dz / L * off, hf.sample(p.x, p.z) + 3, p.z + dx / L * off]; }));
      const st = []; S.forEach((p, i) => { if (i % 4) return; const g = hf.sample(p.x, p.z); st.push([p.x, g, p.z, p.x, g + 3, p.z]); }); B.segs(st); } },
  crates:  { cat:'build', name:'Склад контейнеров', desc:'Штабеля грузовых контейнеров', side:'neutral', tag:'Склад', r:9, top:7, fp:[9, 6],
    build(B) { [[-5, 0, -3, 0], [1, 0, -3, 0], [-5, 0, 3, 0], [-2, 3, -3, 0], [6, 0, 3, .4]].forEach(([x, y, z, r]) => B.box(5, 3, 2.6, x, y, z, r)); } },
  /* --- особые --- */
  relay:   { cat:'special', name:'Узел ретрансляции', desc:'Мачта с антенной и аппаратной', side:'target', tag:'Основная цель', r:13, top:30, fp:[9, 7],
    build(B) { B.box(16, 3, 11); B.box(6, 6, 6, -4, 3, 1); B.lattice(.7, 2.4, 28, 3, 3, -1);
      B.cyl(4.5, 1, 1.6, 10, 3, 22, -1, { open:true, rx:1.0, ry:.6, center:true }); B.box(2.5, 2.5, 2.5, 7, 3, 3); } },
  reactor: { cat:'special', name:'Реактор', desc:'Энергоблок с градирней', side:'neutral', tag:'Особый объект', r:12, top:22,
    build(B) { B.cyl(9, 11, 10, 14); B.cyl(5, 9, 5, 14, 0, 10, 0); B.cyl(1.6, 1.6, 12, 6, 7, 10, 4); } },
  dome:    { cat:'special', name:'Генератор щита', desc:'Купол силового поля: радиус и цвет', side:'neutral', tag:'Особый объект', r:o => o.radius, top:o => o.radius, fp:[4, 4],
    params:{ radius:22, color:'grey' }, tint:o => new THREE.Color(DOME_COLORS[o.color] || DOME_COLORS.grey),
    build(B, o) { B.add(new THREE.SphereGeometry(o.radius, 18, 7, 0, Math.PI * 2, 0, Math.PI / 2), 0, 0, 0, 0, 0, 0, { wire:true }); B.cyl(2.5, 3, 4, 8);
      const m = shellMat(B.e.col, B.W.time, o.radius), s = new THREE.Mesh(new THREE.SphereGeometry(o.radius * .995, 48, 20, 0, Math.PI * 2, 0, Math.PI / 2), m);
      s.renderOrder = 2; B.p.add(s); B.e.shells.push(m); } },
  wreck:   { cat:'special', name:'Обломки корабля', desc:'Разбитый корпус и обломки', side:'neutral', tag:'Особый объект', r:20, top:12, pad:false,
    build(B) { B.add(new THREE.BoxGeometry(34, 7, 10), 0, 2.4, 0, 0, 0, .14); B.add(new THREE.CylinderGeometry(0, 5.5, 10, 4), -21.5, .3, 0, Math.PI / 4, 0, Math.PI / 2 + .14);
      B.box(8, 6, 1, 11, 6, 0, 0); B.box(3, 2, 4, 12, 0, 11, .6); B.box(2, 1.5, 2, -8, 0, -11, .3); B.box(4, 1, 2, 20, 0, -8, 1); } },
  mechwreck:{ cat:'special', name:'Подбитый мех', desc:'Рухнувший мех и разбросанные части', side:'neutral', tag:'Особый объект', r:8, top:5, pad:false,
    build(B) { B.tilt(3.4, 2.4, 3, 0, 1.4, 0, .3, 0, .9); B.tilt(1, 3.4, 1, -3, .6, 2, 1.4, .3, 0); B.tilt(1, 3.4, 1, 3.5, .5, -1.5, 1.2, -.8, .2);
      B.cyl(.3, .3, 4, 5, 2, .6, 3.5, { rx:Math.PI / 2, ry:.8, center:true }); B.box(1.4, .8, 1, -5, 0, -3, .6); B.box(.8, .5, 1.6, 5, 0, 4, 1.1); } },
  drill:   { cat:'special', name:'Буровая вышка', desc:'Добывающая установка над скважиной', side:'neutral', tag:'Промышленность', r:8, top:30, fp:[6, 6],
    build(B) { B.box(12, 2, 12); B.lattice(1, 4, 26, 0, 2, 0, 8); B.box(4, 3, 5, 4, 2, -3); B.segs([[0, 2, 0, 0, 28, 0]]); B.cyl(.5, .5, 3, 6, -4, 2, 4); } },
  artifact:{ cat:'special', name:'Артефакт', desc:'Монолит неизвестного происхождения', side:'neutral', tag:'Аномалия', r:5, top:26, fp:[4, 4],
    build(B) { B.cyl(1.2, 2.4, 18, 4, 0, 0, 0, { ry:Math.PI / 4 });
      const g = B.group(0, 23, 0); g.userData.spd = .6; B.e.spin.push(g);
      B.into(g, () => { B.oct(1.6, 0, 0, 0); B.poly(Array.from({ length:33 }, (_, i) => { const a = i / 32 * 6.283; return [Math.cos(a) * 4.5, 0, Math.sin(a) * 4.5]; })); });
      const g2 = B.group(0, 12, 0); g2.userData.spd = -.4; B.e.spin.push(g2); g2.rotation.z = .35;
      B.into(g2, () => B.poly(Array.from({ length:33 }, (_, i) => { const a = i / 32 * 6.283; return [Math.cos(a) * 6.5, 0, Math.sin(a) * 6.5]; }))); } },
  launch:  { cat:'special', name:'Стартовый стол', desc:'Ракета на пусковой площадке с фермой', side:'neutral', tag:'Особый объект', r:12, top:34, fp:[10, 10],
    build(B) { B.cyl(10, 11, 1.5, 8); B.cyl(2.2, 2.2, 22, 10, 0, 1.5, 0); B.cyl(0, 2.2, 6, 10, 0, 23.5, 0); B.cyl(3.2, 2.2, 3, 4, 0, 1.5, 0, { open:true });
      B.lattice(1.2, 1.6, 28, 6, 1.5, 0, 9); B.segs([[4.8, 18, 0, 2.2, 18, 0], [4.8, 10, 0, 2.2, 10, 0]]); } },
  array:   { cat:'special', name:'Антенная решётка', desc:'Поле параболических антенн', side:'neutral', tag:'Связь', r:12, top:8, fp:[11, 11],
    build(B) { for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const x = i * 8, z = j * 8; B.cyl(.3, .3, 3, 5, x, 0, z, { fill:false }); B.cyl(3, .6, 1.2, 10, x, 4.4, z, { open:true, rx:.7, center:true }); } } },
  beacon:  { cat:'special', name:'Маяк', desc:'Навигационный или сигнальный маяк', side:'neutral', tag:'Особый объект', r:3, top:24,
    build(B) { B.cyl(.4, .8, 20, 5); const g = B.group(0, 22, 0); g.userData.spd = 1.5; B.e.spin.push(g); B.into(g, () => B.oct(2, 0, 0, 0)); } },
  /* --- оборона --- */
  turret:  { cat:'defense', name:'Турель', desc:'Стационарная огневая точка с сектором обстрела', side:'hostile', tag:'Угроза · стационар', r:5, top:6, params:{ range:48, arc:100 },
    build(B) { B.box(7, 3, 7); B.box(3.4, 1.8, 3.4, 0, 3, 0); B.cyl(.35, .35, 6, 5, 0, 4, 3.6, { rx:Math.PI / 2, center:true }); },
    extras(X, o, e) { X.fan(o.x, o.z, (o.rot || 0) * DEG, o.arc * DEG, o.range); X.beam(o.x, e.body.position.y + 5, o.z, 9); } },
  artillery:{ cat:'defense', name:'Артиллерия', desc:'Дальнобойное орудие, круговой обстрел', side:'hostile', tag:'Угроза · стационар', r:6, top:9, params:{ range:90 },
    build(B) { B.box(9, 2.4, 9); B.cyl(3, 3.4, 2, 8, 0, 2.4, 0); B.cyl(.5, .6, 12, 6, 0, 6.5, 3.5, { rx:Math.PI / 2 - .55, center:true }); },
    extras(X, o, e) { X.loop(o.x, o.z, o.range, { dash:6, gap:.4, speed:1, op:.8 }); X.loop(o.x, o.z, o.range * .25, { op:.3 }); X.beam(o.x, e.body.position.y + 8, o.z, 8); } },
  sam:     { cat:'defense', name:'ПВО', desc:'Зенитный ракетный комплекс', side:'hostile', tag:'Угроза · ПВО', r:5, top:7, params:{ range:70 },
    build(B) { B.box(8, 2, 6); B.add(new THREE.BoxGeometry(5, 2.6, 4), 0, 4.2, -.5, -.5, 0, 0);
      B.segs([[-1.5, 3.5, 1.2, -1.5, 5.6, -2.4], [1.5, 3.5, 1.2, 1.5, 5.6, -2.4]]); },
    extras(X, o, e) { X.loop(o.x, o.z, o.range, { dash:2, gap:.6, speed:-1.5, op:.75 }); X.beam(o.x, e.body.position.y + 7, o.z, 8); } },
  watchtower:{ cat:'defense', name:'Наблюдательная вышка', desc:'Пост наблюдения с радиусом обзора', side:'hostile', tag:'Угроза · наблюдение', r:3, top:14, params:{ range:55 }, fp:[3, 3],
    pui:{ range:{ label:'Радиус обзора' } },
    build(B) { B.segs([[-2, 0, -2, -1.2, 10, -1.2], [2, 0, -2, 1.2, 10, -1.2], [-2, 0, 2, -1.2, 10, 1.2], [2, 0, 2, 1.2, 10, 1.2], [-1.7, 4, -1.7, 1.7, 4, 1.7], [1.7, 4, -1.7, -1.7, 4, 1.7]]);
      B.box(3.6, 2.4, 3.6, 0, 10, 0); B.box(4.4, .3, 4.4, 0, 12.4, 0); },
    extras(X, o, e) { X.loop(o.x, o.z, o.range, { dash:1.2, gap:.6, op:.55 }); X.beam(o.x, e.body.position.y + 13, o.z, 6); } },
  minefield:{ cat:'defense', name:'Минное поле', desc:'Заминированная зона, радиус настраивается', side:'hostile', tag:'Угроза · мины', r:o => o.radius, top:2, params:{ radius:18 }, pad:false,
    build(B, o) { const hf = B.W.hf, y0 = hf.sample(o.x, o.z), rnd = mulberry32(Math.round(o.x * 13 + o.z * 7)), n = Math.round(o.radius * o.radius / 18), s = [];
      for (let i = 0; i < n; i++) { const a = rnd() * 6.28, r = Math.sqrt(rnd()) * o.radius * .92, x = Math.cos(a) * r, z = Math.sin(a) * r, y = hf.sample(o.x + x, o.z + z) - y0 + .5;
        s.push([x - .8, y, z - .8, x + .8, y, z + .8], [x - .8, y, z + .8, x + .8, y, z - .8]); }
      B.segs(s); },
    extras(X, o) { X.loop(o.x, o.z, o.radius, { dash:2, gap:.5, op:.8 }); } },
  barricade:{ cat:'defense', name:'Заграждение', desc:'Ряд противотанковых ежей', side:'hostile', tag:'Укрепление', r:o => o.length / 2, top:3, params:{ length:24 }, pad:false,
    build(B, o) { const s = []; for (let x = -o.length / 2; x <= o.length / 2; x += 3) { const g = B.groundAt(x, 0);
      s.push([x - 1, g, -1, x + 1, g + 2.2, 1], [x - 1, g, 1, x + 1, g + 2.2, -1], [x + 1, g, -1, x - 1, g + 2.2, 1]); } B.segs(s); } },
  trench:  { cat:'defense', path:true, terra:'channel', name:'Траншея', desc:'Окоп вдоль точек: роет землю и ставит бруствер', side:'hostile', tag:'Укрепление', r:3, top:2, params:{ pts:[], width:3.5, depth:2.4 },
    pui:{ width:{ min:2, max:8 }, depth:{ min:1, max:5 } },
    build(B, o) { const S = smoothPath(o.pts, 2), hf = B.W.hf; if (S.length < 2) return;
      for (const k of [-1, 1]) B.poly(S.map((p, i) => { const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
        const x = p.x - dz / L * (o.width / 2 + 1.2) * k, z = p.z + dx / L * (o.width / 2 + 1.2) * k; return [x, hf.sample(x, z) + .9, z]; })); } },
  /* --- отряды (едут по вейпоинтам) --- */
  infantry:{ cat:'squad', kind:'squad', name:'Отряд пехоты', unitName:'пехота', desc:'1–10 бойцов, маршрут по вейпоинтам', side:'hostile', tag:'Угроза · подвижная', top:3.5, spacing:3,
    params:{ count:6, speed:1.2, loop:false, wp:[] }, unit(B) { B.cyl(0, .9, 2.4, 3); B.oct(.5, 0, 3, 0); } },
  mech:    { cat:'squad', kind:'squad', name:'Звено мехов', unitName:'мех', desc:'1–10 мехов, маршрут по вейпоинтам', side:'hostile', tag:'Угроза · подвижная', top:5, spacing:7,
    params:{ count:2, speed:2.5, loop:true, wp:[] },
    unit(B) { B.box(.8, 2.6, .9, -1, 0, 0); B.box(.8, 2.6, .9, 1, 0, 0); B.box(3.2, 2, 2.4, 0, 2.6, 0); B.box(1.4, .9, 1, 0, 3.2, 1.6); B.cyl(.22, .22, 3, 4, 1.9, 3.6, .8, { rx:Math.PI / 2, center:true }); } },
  armor:   { cat:'squad', kind:'squad', name:'Бронетехника', unitName:'танк', desc:'1–10 машин, маршрут по вейпоинтам', side:'hostile', tag:'Угроза · подвижная', top:3, spacing:9,
    params:{ count:3, speed:3.5, loop:false, wp:[] }, unit(B) { B.box(4, 1.4, 6.5); B.box(2.6, 1.1, 2.8, 0, 1.4, -.3); B.cyl(.18, .18, 4, 4, 0, 2, 2.6, { rx:Math.PI / 2, center:true }); } },
  drones:  { cat:'squad', kind:'squad', name:'Рой дронов', unitName:'дрон', desc:'1–10 дронов, летят над рельефом', side:'hostile', tag:'Угроза · воздух', top:2, spacing:5, fly:9,
    params:{ count:4, speed:5, loop:true, wp:[] }, unit(B) { B.oct(1.2, 0, 0, 0); B.segs([[-2, 0, 0, 2, 0, 0], [0, 0, -2, 0, 0, 2]]); } },
  gunship: { cat:'squad', kind:'squad', name:'Штурмовики', unitName:'штурмовик', desc:'1–10 винтокрылов, высокий полёт', side:'hostile', tag:'Угроза · воздух', top:3, spacing:12, fly:18,
    params:{ count:2, speed:6, loop:true, wp:[] },
    unit(B) { B.box(2.2, 1.8, 6); B.box(.6, .6, 5, 0, .9, -5); B.box(1.6, .3, 1.2, 0, 2, -7.4); B.segs([[-5, 2.4, 0, 5, 2.4, 0], [0, 2.4, -5, 0, 2.4, 5], [-2.6, .4, 1, 2.6, .4, 1]]); } },
  wild:    { cat:'squad', kind:'squad', glitchy:true, name:'Дикие', unitName:'особь', desc:'1–10 особей с помехами: мех, человек, шар или куб', side:'hostile', tag:'Аномалия · подвижная', top:5, spacing:7,
    params:{ model:'mech', count:3, speed:2, loop:true, glitch:.5, wp:[] },
    unit(B, o) { const m = o.model;
      if (m === 'human') { B.cyl(0, .9, 2.4, 3); B.oct(.5, 0, 3, 0); }
      else if (m === 'sphere') B.add(new THREE.IcosahedronGeometry(2.2, 1), 0, 2.4, 0, 0, 0, 0, { wire:true });
      else if (m === 'cube') B.box(3.4, 3.4, 3.4, 0, .4, 0);
      else CATALOG.mech.unit(B, o); } },
  /* --- рельеф (модификаторы; в плеере видна только земля и вода) --- */
  crater:  { cat:'terra', terra:'crater', name:'Кратер', desc:'Чаша с валом: радиус, глубина, вал', side:'neutral', tag:'Рельеф', r:o => o.radius, top:1,
    params:{ radius:20, depth:7, rim:.8, rough:.5 }, pui:{ radius:{ min:4, max:90 } }, extras(X, o) { editorRing(X, o, o.radius); } },
  shaft:   { cat:'terra', terra:'shaft', name:'Шахта / скважина', desc:'Узкий глубокий ствол с отвесными стенками', side:'neutral', tag:'Рельеф', r:o => o.radius, top:1,
    params:{ radius:4, depth:30, collar:1 }, pui:{ radius:{ min:2, max:24 }, depth:{ min:5, max:120 } },
    extras(X, o) { X.loop(o.x, o.z, o.radius * 1.05, { op:.45, layer:'show', color:C.dim }); editorRing(X, o, o.radius * 1.6); } },
  hill:    { cat:'terra', terra:'hill', name:'Холм', desc:'Возвышенность: радиус, высота, острота', side:'neutral', tag:'Рельеф', r:o => o.radius, top:1,
    params:{ radius:30, height:14, sharp:.3 }, pui:{ radius:{ min:6, max:100 } }, extras(X, o) { editorRing(X, o, o.radius); } },
  mesa:    { cat:'terra', terra:'mesa', name:'Плато', desc:'Столовая гора с плоской вершиной и террасами', side:'neutral', tag:'Рельеф', r:o => o.radius, top:1,
    params:{ radius:28, height:16, terraces:2 }, pui:{ radius:{ min:6, max:100 } }, extras(X, o) { editorRing(X, o, o.radius); } },
  lake:    { cat:'terra', terra:'lake', name:'Озеро', desc:'Котловина с водой', side:'neutral', tag:'Рельеф', r:o => o.radius, top:1,
    params:{ radius:24, depth:6 }, pui:{ radius:{ min:6, max:80 }, depth:{ max:20 } }, extras(X, o) { X.lakeSurface(o); editorRing(X, o, o.radius); } },
  river:   { cat:'terra', path:true, terra:'channel', monotone:true, name:'Река', desc:'Русло с водой; течёт от первой точки к последней', side:'neutral', tag:'Река', r:3, top:1,
    params:{ pts:[], width:14, depth:6 }, pui:{ depth:{ max:20 } }, extras(X, o) { X.water(o, .35); X.path(o.pts, false, { dash:2, gap:.6, op:.3, color:C.ink, layer:'editor' }); } },
  dryriver:{ cat:'terra', path:true, terra:'channel', monotone:true, name:'Сухое русло', desc:'Высохшая река без воды', side:'neutral', tag:'Русло', r:3, top:1,
    params:{ pts:[], width:16, depth:7 }, pui:{ depth:{ max:20 } }, extras(X, o) { X.path(o.pts, false, { dash:2, gap:.6, op:.3, color:C.ink, layer:'editor' }); } },
  /* --- навигация --- */
  lz:      { cat:'nav', name:'Точка высадки', desc:'Место десантирования пилота', side:'nav', tag:'Навигация', r:7, top:9, fp:[5, 5],
    build(B) { B.poly(hexPts(6, .6), true); for (const y of [6, 8.5]) { B.poly([[-2, y, 0], [0, y - 2, 0], [2, y, 0]]); B.poly([[0, y, -2], [0, y - 2, 0], [0, y, 2]]); } },
    extras(X, o) { X.loop(o.x, o.z, 8, { dash:1.6, gap:.5, speed:1, op:.8 }); } },
  extract: { cat:'nav', name:'Точка эвакуации', desc:'Место эвакуации после задания', side:'nav', tag:'Навигация', r:7, top:9, fp:[5, 5],
    build(B) { B.poly(hexPts(6, .6), true); for (const y of [4, 6.5]) { B.poly([[-2, y, 0], [0, y + 2, 0], [2, y, 0]]); B.poly([[0, y, -2], [0, y + 2, 0], [0, y, 2]]); } },
    extras(X, o) { X.loop(o.x, o.z, 8, { dash:1.6, gap:.5, speed:-1, op:.8 }); } },
  waypoint:{ cat:'nav', name:'Точка интереса', desc:'Отметка на карте с подписью', side:'nav', tag:'Навигация', r:4, top:12, pad:false,
    build(B) { B.segs([[0, 0, 0, 0, 9, 0]]); B.oct(1.4, 0, 10.5, 0); }, extras(X, o) { X.loop(o.x, o.z, 4, { op:.7 }); } },
  zone:    { cat:'nav', kind:'zone', name:'Зона', desc:'Круглая область: район операции, опасная зона', side:'nav', tag:'Граница', r:o => o.radius, top:0, params:{ radius:60 },
    extras(X, o) { X.loop(o.x, o.z, o.radius, { dash:5, gap:.5, speed:1.5, op:.6, lift:1.2 }); } },
  route:   { cat:'nav', kind:'route', path:true, name:'Маршрут', desc:'Путь по точкам с анимацией прорисовки', side:'nav', tag:'Маршрут', r:4, top:0, params:{ pts:[], draw:true },
    extras(X, o) { X.route(o.pts); } },
};
for (const k in CATALOG) { CATALOG[k].id = k; CATALOG[k].icon = ICON[k] || ''; }
function valOf(v, o) { return typeof v === 'function' ? v(o) : (v || 0); }

function makeObject(type, x = 0, z = 0) {
  const d = CATALOG[type];
  const o = { id:uid(), type, name:d.name, tag:d.tag, side:d.side, x, z, rot:0, scale:1, show:'start', mark:'start', label:true, meta:'' };
  Object.assign(o, clone(d.params || {}));
  if (d.path) o.pts = [[x, z]];
  if (d.cat === 'terra') { o.label = false; o.mark = 'never'; }
  if (!d.kind && !d.terra && !d.path && d.pad !== false) o.ground = true;
  return o;
}
function randomPath(seed, nPts = 7) {
  const N = makeNoise(seed), a = N.rnd() * 6.283, b = a + Math.PI + (N.rnd() - .5) * 1.2, R = RMAX * 1.02;
  const A = [Math.cos(a) * R, Math.sin(a) * R], Bp = [Math.cos(b) * R, Math.sin(b) * R], dx = Bp[0] - A[0], dz = Bp[1] - A[1], L = Math.hypot(dx, dz), nx = -dz / L, nz = dx / L, pts = [];
  for (let i = 0; i <= nPts; i++) { const t = i / nPts, off = (i === 0 || i === nPts) ? 0 : (N.rnd() - .5) * 70 * Math.sin(t * Math.PI);
    pts.push([Math.round(A[0] + dx * t + nx * off), Math.round(A[1] + dz * t + nz * off)]); }
  return pts;
}

/* =========================== мир (сцена из сценария) =========================== */
function pathOf(o) {
  const pts = [[o.x, o.z], ...(o.wp || [])], closed = !!o.loop && pts.length > 2;
  const Pp = closed ? [...pts, pts[0]] : pts, cum = [0];
  for (let i = 1; i < Pp.length; i++) cum.push(cum[i - 1] + Math.hypot(Pp[i][0] - Pp[i - 1][0], Pp[i][1] - Pp[i - 1][1]));
  return { P:Pp, cum, len:cum[cum.length - 1], closed };
}
function pathAt(path, s) {
  const { P:Pp, cum } = path; let i = 1; while (i < Pp.length - 1 && cum[i] < s) i++;
  const t = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]), a = Pp[i - 1], b = Pp[i];
  return { x:a[0] + (b[0] - a[0]) * t, z:a[1] + (b[1] - a[1]) * t, dx:b[0] - a[0], dz:b[1] - a[1] };
}
function disposeTree(root) { root.traverse(n => { if (n.geometry) n.geometry.dispose(); }); }

class World {
  constructor(scene, hf, opt = {}) {
    this.scene = scene; this.hf = hf; this.opt = opt; this.time = opt.time || { value:0 };
    this.ents = new Map(); this.stepIdx = new Map();
    this.terrain = makeTerrain(hf, this.time, opt.terrain || {}); scene.add(this.terrain.mesh);
    this.fill = new THREE.MeshBasicMaterial({ color:C.bg, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1 });
    this.minOp = opt.minOpacity || 0;
    this.animateDraw = opt.animateDraw !== false;
    this.animSquads = true;
    this.vis = -1; this.v = new THREE.Vector3();
  }
  onT(x, z, lift = .9) { return new THREE.Vector3(x, this.hf.sample(x, z) + lift, z); }
  loopPts(cx, cz, r, n = 180, lift) { const a = []; for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2; a.push(this.onT(cx + Math.cos(t) * r, cz + Math.sin(t) * r, lift)); } return a; }
  setSteps(steps) { this.stepIdx.clear(); steps.forEach((s, i) => this.stepIdx.set(s.id, i)); }
  idx(ref) { if (ref == null || ref === 'start') return -1; if (ref === 'never') return Infinity; const i = this.stepIdx.get(ref); return i == null ? -1 : i; }
  load(objs) { this.clear(); objs.forEach(o => this.add(o)); }
  clear() { for (const id of [...this.ents.keys()]) this.remove(id); }
  add(o, prev) {
    const e = this.build(o); if (!e) return null;
    if (prev) { e.cur = prev.cur; e.curX = prev.curX; e.drawP = prev.drawP; if (!o.side || prev.o.side === o.side) e.mat.color.copy(prev.mat.color); }
    this.ents.set(o.id, e); this.scene.add(e.root); return e;
  }
  rebuild(o) { const prev = this.ents.get(o.id); if (prev) { this.scene.remove(prev.root); disposeTree(prev.root); this.ents.delete(o.id); } return this.add(o, prev); }
  remove(id) { const e = this.ents.get(id); if (!e) return; this.scene.remove(e.root); disposeTree(e.root); this.ents.delete(id); }
  rebuildAll(objs) { const keep = new Set(objs.map(o => o.id)); for (const id of [...this.ents.keys()]) if (!keep.has(id)) this.remove(id); objs.forEach(o => this.rebuild(o)); }
  snapBodies() { for (const e of this.ents.values()) if (e.def.kind !== 'squad' && !e.def.path) e.body.position.y = this.hf.sample(e.o.x, e.o.z); }

  build(o, ghost) {
    const def = CATALOG[o.type]; if (!def) return null;
    const side = SIDES[o.side] || SIDES.neutral, sc = o.scale || 1;
    const tint = def.tint ? def.tint(o) : null;
    const base = tint || (o.side === 'neutral' ? C.dim : C.ink);
    const e = { o, def, side, W:this, ghost:!!ghost, root:new THREE.Group(), body:new THREE.Group(), extras:new THREE.Group(),
      mat:lineMat(base, .95), base, col:tint || C[side.col], fills:[], xmats:[], smats:[], emats:[], shells:[], spin:[], units:[],
      cur:0, curX:0, drawP:0, lead:new THREE.Vector3(o.x, 0, o.z), shown:false, marked:false };
    e.root.add(e.body, e.extras);
    const B = new Builder(e, this.fill), X = new Extras(this, e);
    if (def.kind === 'squad') {
      for (let k = 0; k < Math.max(1, Math.min(10, o.count | 0)); k++) { const u = new THREE.Group(); B.into(u, () => def.unit(B, o)); u.scale.setScalar(sc); e.root.add(u); e.units.push(u); }
      if (def.glitchy) {                       // «двойник» для помех: та же геометрия, другим цветом, виден только во время сбоя
        e.gmat = lineMat(e.col === C.hot ? C.ink : C.hot, .7);
        e.units.forEach(u => { const g = u.clone(true); g.traverse(n => { if (n.isMesh) n.visible = false; else if (n.isLine) n.material = e.gmat; }); g.visible = false; e.root.add(g); u.userData.ghost = g; });
      }
      e.path = pathOf(o);
      if (o.wp && o.wp.length) X.path([[o.x, o.z], ...o.wp], !!o.loop, { dash:2.4, gap:.55, speed:2, op:.5 });
      this.moveSquad(e, 0);
    } else if (def.path) {
      if (def.build) def.build(B, o);          // мировые координаты, тело в начале координат
      if (def.extras) def.extras(X, o, e);
    } else {
      e.body.position.set(o.x, this.hf.sample(o.x, o.z), o.z); e.body.rotation.y = (o.rot || 0) * DEG; e.body.scale.setScalar(sc);
      if (def.build) def.build(B, o);
      if (def.extras) def.extras(X, o, e);
    }
    if (o.side === 'target' && def.kind !== 'route' && def.kind !== 'zone' && def.cat !== 'terra') {
      const r = valOf(def.r, o) * sc + 3, p = this.entityPos(e), top = valOf(def.top, o) * sc;
      X.loop(p.x, p.z, r, { dash:2.2, gap:.45, speed:3, op:.95, lift:1.2 });
      X.beam(p.x, p.y + top + 1, p.z, 14, { op:.95 }); X.pulse(p.x, p.y + 1.5, p.z); e.pulseR = r;
    }
    return e;
  }
  setGhost(o) { if (this.ghost) { this.scene.remove(this.ghost.root); disposeTree(this.ghost.root); this.ghost = null; } if (o) { this.ghost = this.build(o, true); if (this.ghost) this.scene.add(this.ghost.root); } }

  moveSquad(e, t) {
    const o = e.o, Pth = e.path, sp = o.speed || 0; let x = o.x, z = o.z, hd = (o.rot || 0) * DEG;
    if (Pth.len > .5) { let s = this.animSquads ? t * sp : 0, back = false;
      if (Pth.closed) s %= Pth.len; else { const m = s % (2 * Pth.len); back = m >= Pth.len; s = back ? 2 * Pth.len - m : m; }
      const q = pathAt(Pth, s); x = q.x; z = q.z; hd = Math.atan2(q.dx, q.dz) + (back ? Math.PI : 0); }
    e.lead.set(x, this.hf.sample(x, z), z); e.heading = hd;
    const fx = Math.sin(hd), fz = Math.cos(hd), sp2 = e.def.spacing * (o.scale || 1), fly = e.def.fly || 0;
    e.units.forEach((u, k) => { const rank = Math.ceil(k / 2), side = k === 0 ? 0 : (k % 2 ? -1 : 1) * rank * sp2 * .7, back = rank * sp2 * .8;
      const px = x + fz * side - fx * back, pz = z - fx * side - fz * back;
      u.position.set(px, this.hf.sample(px, pz) + (fly ? fly + Math.sin(t * 2 + k) * .6 : 0), pz); u.rotation.y = hd; });
    if (e.def.glitchy) this.glitch(e, t);
  }
  /* Помехи «диких»: редкие короткие сбои, иногда сериями — геометрию рвёт, сдвигает и двоит. */
  glitch(e, t) {
    const o = e.o, g = o.glitch ?? .5, sc = o.scale || 1, gh = (k, s, salt) => { const v = Math.sin(k * 127.1 + s * 311.7 + salt * 74.7) * 43758.5453; return v - Math.floor(v); };
    const r = Math.random, slot = Math.floor(t * 7), burst = Math.floor(t * .7);
    e.units.forEach((u, k) => {
      const ghost = u.userData.ghost, on = g > 0 && gh(k, slot, 1) < g * .2 + (gh(k, burst, 2) < g * .3 ? .45 : 0);
      if (on) {
        u.scale.set(sc * (1 + (r() - .3) * 1.4 * g), sc * (1 - r() * .7 * g), sc * (1 + (r() - .5) * 1.2 * g));
        u.position.x += (r() - .5) * 4 * g; u.position.y += (r() - .3) * 2 * g; u.rotation.y += (r() - .5) * 2 * g; u.rotation.z = (r() - .5) * .7 * g;
        u.visible = r() > .2;
        ghost.visible = true; ghost.position.copy(u.position); ghost.position.x += (r() - .5) * 8 * g; ghost.position.z += (r() - .5) * 5 * g; ghost.position.y += r() * 1.5 * g;
        ghost.rotation.copy(u.rotation); ghost.scale.set(sc * (1 + r() * .9 * g), sc * (.35 + r() * .9), sc * (1 + (r() - .5) * g));
      } else { u.scale.setScalar(sc); u.rotation.z = 0; u.visible = true; ghost.visible = false; }
    });
  }
  entityPos(e, v = new THREE.Vector3()) {
    if (e.def.kind === 'squad') return v.copy(e.lead);
    if (e.def.path && e.o.pts && e.o.pts.length) { const [x, z] = e.o.pts[0]; return v.set(x, this.hf.sample(x, z), z); }
    return v.set(e.o.x, this.hf.sample(e.o.x, e.o.z), e.o.z);
  }
  anchor(e, v) {
    const o = e.o, d = e.def, sc = o.scale || 1;
    if (d.kind === 'squad') return v.copy(e.lead).setY(e.lead.y + d.top * sc + 4 + (d.fly || 0));
    if (d.kind === 'zone') { const a = -2.3, x = o.x + Math.cos(a) * o.radius, z = o.z + Math.sin(a) * o.radius; return v.set(x, this.hf.sample(x, z) + 1.5, z); }
    if (d.kind === 'route' && e.routePts) { const p = e.routePts[e.routePts.length >> 1]; return v.copy(p).setY(p.y + 3); }
    if (d.path && o.pts && o.pts.length > 1) { const S = smoothPath(o.pts, 4), p = S[S.length >> 1]; return v.set(p.x, this.hf.sample(p.x, p.z) + 4, p.z); }
    return v.set(o.x, this.hf.sample(o.x, o.z) + valOf(d.top, o) * sc + (o.side === 'target' ? 16 : 3), o.z);
  }
  routePoint(e, f) {
    if (!e.routePts) return this.entityPos(e);
    const d = Math.min(1, Math.max(0, f)) * e.routeLen, ld = e.routeLd; let i = 1; while (i < ld.length - 1 && ld[i] < d) i++;
    const t = (d - ld[i - 1]) / Math.max(1e-6, ld[i] - ld[i - 1]); return e.routePts[i - 1].clone().lerp(e.routePts[i], t);
  }
  metaOf(e) {
    const o = e.o, d = e.def; if (o.meta) return o.meta;
    const parts = [`ELV ${elv(this.entityPos(e, this.v).y)} M`];
    if (d.kind === 'squad') parts.push(`СОСТАВ ×${o.count}`);
    else if (o.range) parts.push(`R ${(o.range * UNIT_M / 1000).toFixed(1)} KM`);
    else if (o.radius) parts.push(`R ${(o.radius * UNIT_M / 1000).toFixed(1)} KM`);
    return parts.join(' · ');
  }

  /* vis — индекс текущего шага брифинга; revealed — карта уже проявилась */
  tick(dt, t, vis, revealed = true) {
    this.vis = vis; const k = 1 - Math.exp(-dt * 3.5);
    const each = e => {
      const o = e.o, si = this.idx(o.show), mi = Math.max(si, this.idx(o.mark));
      const shown = e.ghost || (revealed && vis >= si), marked = e.ghost || (shown && vis >= mi);
      e.shown = shown; e.marked = marked;
      const want = e.ghost ? .55 : shown ? 1 : this.minOp, wantX = e.ghost ? .55 : marked ? 1 : this.minOp * .6;
      e.cur += (want - e.cur) * k; e.curX += (wantX - e.curX) * k;
      e.mat.opacity = e.cur * e.mat.userData.base; e.mat.color.lerp(marked ? e.col : e.base, k);
      e.fills.forEach(f => f.visible = e.cur > .35);
      e.xmats.forEach(m => setOp(m, e.curX * m.userData.base));
      e.smats.forEach(m => setOp(m, e.cur * m.userData.base));
      e.emats.forEach(m => setOp(m, m.userData.base));
      e.shells.forEach(m => { m.uniforms.uOp.value = e.cur; });
      if (e.gmat) e.gmat.opacity = e.cur * e.gmat.userData.base;
      if (e.pulse) { const ph = (t * .55) % 1; e.pulse.scale.setScalar(e.pulseR * (.35 + ph * 1.6)); e.pulseMat.opacity = e.curX * (1 - ph) * .8; }
      if (e.routeMat) {
        if (!marked) e.drawP = 0; else if (e.ghost || !this.animateDraw || o.draw === false || vis > mi) e.drawP = 1; else e.drawP = Math.min(1, e.drawP + dt / 6);
        e.routeMat.uniforms.uProg.value = e.drawP >= 1 ? 1e9 : ss(0, 1, e.drawP) * e.routeLen;
      }
      if (e.units.length) this.moveSquad(e, t);
      e.spin.forEach(g => g.rotation.y += dt * g.userData.spd);
    };
    for (const e of this.ents.values()) each(e);
    if (this.ghost) each(this.ghost);
  }
}

/* =========================== маркеры (HTML поверх 3D) =========================== */
class MarkerLayer {
  constructor(el, opt = {}) { this.el = el; this.map = new Map(); this.onShow = opt.onShow; this.v = new THREE.Vector3(); }
  sync(W) {
    for (const [id, e] of W.ents) {
      const kind = e.def.kind === 'zone' ? 'area' : e.side.mk, meta = W.metaOf(e);
      const sig = [kind, e.o.name, e.o.tag, meta].join('|'); let m = this.map.get(id);
      if (m && m.sig === sig) continue;
      if (m) m.el.remove();
      const el = document.createElement('div'); el.className = 'mk ' + kind;
      el.innerHTML = `<i class="pip"></i><svg class="ld" width="1" height="1"><polyline points="0,0 28,-28"/></svg><div class="lbl"><small></small><b></b><span class="meta"></span></div>`;
      el.querySelector('small').textContent = e.o.tag || ''; el.querySelector('b').textContent = e.o.name || ''; el.querySelector('.meta').textContent = meta;
      this.el.appendChild(el); this.map.set(id, { el, sig, on:false, flip:false });
    }
    for (const [id, m] of this.map) if (!W.ents.has(id)) { m.el.remove(); this.map.delete(id); }
  }
  update(W, camera, w, h) {
    for (const [id, m] of this.map) {
      const e = W.ents.get(id); if (!e) continue;
      const on = e.marked && e.o.label !== false;
      if (on !== m.on) { m.on = on; m.el.classList.toggle('on', on); if (on && this.onShow) this.onShow(e); }
      if (!on) continue;
      W.anchor(e, this.v).project(camera);
      if (this.v.z > 1 || Math.abs(this.v.x) > 1.3 || Math.abs(this.v.y) > 1.3) { m.el.style.visibility = 'hidden'; continue; }
      m.el.style.visibility = '';
      const sx = (this.v.x * .5 + .5) * w, sy = (-this.v.y * .5 + .5) * h;
      if (m.flip !== (sx > w - 260)) { m.flip = !m.flip; m.el.classList.toggle('flip', m.flip); }
      m.el.style.transform = `translate3d(${sx.toFixed(1)}px,${sy.toFixed(1)}px,0)`;
    }
  }
  clear() { for (const m of this.map.values()) m.el.remove(); this.map.clear(); }
}

/* =========================== эмблемы заказчиков =========================== */
const EMBLEMS = {
  hex:    { name:'Шестигранник', svg:'<g fill="none" stroke="currentColor" stroke-width="2"><path d="M32 4 56 18v28L32 60 8 46V18Z"/><path d="M18 42 32 21l14 21"/><path d="M25 42l7-10.5L39 42"/><path d="M14 42h36" stroke-width="1.2"/><rect x="29.5" y="11" width="5" height="5" fill="currentColor" stroke="none" transform="rotate(45 32 13.5)"/></g>' },
  shield: { name:'Щит', svg:'<g fill="none" stroke="currentColor" stroke-width="2"><path d="M32 4 54 12v18c0 15-10 25-22 30C20 55 10 45 10 30V12Z"/><path d="M32 14v36M20 26h24" stroke-width="1.4"/><path d="M24 38l8 6 8-6"/></g>' },
  wing:   { name:'Крыло', svg:'<g fill="none" stroke="currentColor" stroke-width="2"><circle cx="32" cy="32" r="27"/><path d="M8 34 32 20l24 14M14 38l18-10 18 10M22 42l10-6 10 6"/></g>' },
  ring:   { name:'Кольцо', svg:'<g fill="none" stroke="currentColor" stroke-width="2"><circle cx="32" cy="32" r="26"/><circle cx="32" cy="32" r="14"/><path d="M32 2v14M32 48v14M2 32h14M48 32h14" stroke-width="1.4"/><circle cx="32" cy="32" r="4" fill="currentColor" stroke="none"/></g>' },
};

/* =========================== портреты =========================== */
const portraitCache = new Map();
/* Заглушка портрета: голографический силуэт, вариации — от имени. */
function portraitPlaceholder(name = '') {
  if (portraitCache.has(name)) return portraitCache.get(name);
  let hsh = 7; for (const ch of name) hsh = (hsh * 31 + ch.charCodeAt(0)) | 0;
  const R = mulberry32(hsh), W = 240, H = 300, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#15181a'); g.addColorStop(1, '#0a0b0c'); x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.strokeStyle = 'rgba(223,226,216,.08)'; for (let i = 0; i < W; i += 20) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); }
  const cx = W / 2, hy = 118 + R() * 10, hr = 46 + R() * 8, sh = 150 + R() * 30;
  x.fillStyle = '#2a2e30'; x.strokeStyle = 'rgba(223,226,216,.85)'; x.lineWidth = 2;
  x.beginPath(); x.moveTo(cx - sh / 2 - 30, H); x.quadraticCurveTo(cx - sh / 2, hy + hr + 30, cx, hy + hr + 22); x.quadraticCurveTo(cx + sh / 2, hy + hr + 30, cx + sh / 2 + 30, H); x.closePath(); x.fill(); x.stroke();
  x.beginPath(); x.ellipse(cx, hy, hr * .82, hr, 0, 0, Math.PI * 2); x.fill(); x.stroke();
  const kind = Math.floor(R() * 3);
  if (kind === 0) { x.beginPath(); x.moveTo(cx - hr * .75, hy - 6); x.lineTo(cx + hr * .75, hy - 6); x.lineTo(cx + hr * .6, hy + 10); x.lineTo(cx - hr * .6, hy + 10); x.closePath(); x.fillStyle = 'rgba(255,90,44,.55)'; x.fill(); x.stroke(); }
  else if (kind === 1) { x.beginPath(); x.arc(cx, hy - 4, hr * 1.02, Math.PI * 1.05, Math.PI * 1.95); x.stroke(); x.beginPath(); x.moveTo(cx + hr * .8, hy - 20); x.lineTo(cx + hr * 1.2, hy - 70); x.stroke(); }
  else { x.fillStyle = 'rgba(223,226,216,.7)'; x.fillRect(cx - 22, hy - 6, 14, 4); x.fillRect(cx + 8, hy - 6, 14, 4); x.beginPath(); x.moveTo(cx - hr * .9, hy + 20); x.lineTo(cx + hr * .9, hy + 20); x.stroke(); }
  x.fillStyle = 'rgba(0,0,0,.25)'; for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1);
  const url = c.toDataURL('image/png'); portraitCache.set(name, url); return url;
}
/* Уменьшение загруженного портрета до 240×300 (обрезка по центру) — чтобы сценарий оставался лёгким. */
function downscalePortrait(file) {
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => {
    const W = 240, H = 300, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
    const k = Math.max(W / img.width, H / img.height), w = img.width * k, h = img.height * k; x.drawImage(img, (W - w) / 2, (H - h) / 3, w, h);
    res(c.toDataURL('image/jpeg', .86)); URL.revokeObjectURL(img.src); }; img.onerror = rej; img.src = URL.createObjectURL(file); });
}
function speakerOf(sc, st) {
  const id = (st && st.speakerId) || sc.meta.speakerId, c = sc.cast.find(x => x.id === id) || sc.cast[0] || { name:'', role:'', portrait:'' };
  const name = (st && st.speaker) || c.name;
  return { id:c.id, name, role:c.role, image:c.image || '', frame:c.frame || null, portrait:c.portrait || portraitPlaceholder(c.name || name) };
}

/* Портрет в окне связи. Персонаж из каталога студии — картинка с кадром по той же формуле, что рамка
   терминала (client side/scripts/portrait-frame.js): ширина картинки = scale × ширина окна, смещение —
   в долях ширины окна, отражение — scaleX(-1). Окно связи почти той же пропорции, что рамка терминала
   (258×319), поэтому кадр из каталога ложится без пересчёта. Без картинки — свой портрет (data URL)
   или голографическая заглушка, «обложкой». */
function portraitKey(sp) { const f = sp.frame; return sp.image ? `${sp.image}|${f ? [f.scale, f.xRel, f.yRel, f.mirror].join(',') : ''}` : sp.portrait; }
function applyPortrait(el, sp, width) {
  const W = width || el.clientWidth || 122, st = el.style, f = sp.frame || { scale:1, xRel:0, yRel:0, mirror:false };
  st.backgroundRepeat = 'no-repeat';
  if (sp.image) { st.backgroundImage = `url("${assetUrl(sp.image)}")`; st.backgroundSize = `${(f.scale || 1) * 100}%`;
    st.backgroundPosition = `${((f.xRel || 0) * W).toFixed(2)}px ${((f.yRel || 0) * W).toFixed(2)}px`; st.transform = f.mirror ? 'scaleX(-1)' : ''; }
  else { st.backgroundImage = `url("${sp.portrait}")`; st.backgroundSize = 'cover'; st.backgroundPosition = '50% 30%'; st.transform = ''; }
}

/* Палитра сцены под тему брифинга (themes.js). Меняет цвета на месте: всё, что уже ссылается на C,
   перекрашивается тоже, но вызывать лучше до сборки сцены — часть материалов копирует цвет при создании. */
function setPalette(p) { for (const k in p || {}) if (C[k]) { COL[k] = p[k]; C[k].set(p[k]); } }

/* Пути к файлам на сервере (/assets/…) превращаются в адреса по правилу страницы: плеер и редактор
   внутри системы задают его через setAssetResolver, офлайн-демо оставляет пути как есть. */
let assetResolver = p => p;
function setAssetResolver(fn) { assetResolver = fn || (p => p); }
function assetUrl(p) { return !p ? '' : /^(data:|blob:|https?:)/.test(p) ? p : assetResolver(p); }
const isServerRef = id => typeof id === 'string' && (id.startsWith('/assets/') || /^https?:/.test(id));
/* Файл звука по ссылке сценария: путь на сервере или id в хранилище браузера (офлайн-режим). */
async function getAudioBlob(id) {
  if (!id) return null;
  if (isServerRef(id)) { const r = await fetch(assetUrl(id)); return r.ok ? r.blob() : null; }
  return AudioStore.get(id);
}

/* =========================== озвучка (IndexedDB) =========================== */
const AudioStore = {
  db:null,
  open() { if (!this.db) this.db = new Promise((res, rej) => { const r = indexedDB.open('briefing-assets', 1); r.onupgradeneeded = () => r.result.createObjectStore('audio'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); return this.db; },
  async tx(mode, fn) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction('audio', mode), st = t.objectStore('audio'), r = fn(st); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); },
  put(id, blob) { return this.tx('readwrite', s => s.put(blob, id)); },
  get(id) { return this.tx('readonly', s => s.get(id)); },
  del(id) { return this.tx('readwrite', s => s.delete(id)); },
};
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
async function dataURLToBlob(u) { return (await fetch(u)).blob(); }

/* =========================== звуки и музыка =========================== */
/* Стандартные звуки синтезируются на лету. Любой можно заменить своим файлом или выключить,
   к брифингу можно добавить две музыкальные дорожки. Файлы лежат в том же хранилище, что и озвучка. */
const SOUNDS = [
  { id:'click', name:'Нажатие',             desc:'Кнопка «Начать передачу», переход к следующей реплике' },
  { id:'blip',  name:'Печать',              desc:'Строки терминала и печать субтитров без озвучки. Звучит очень часто — нужен короткий щелчок' },
  { id:'open',  name:'Логотип: появление',  desc:'Заставка заказчика, принятие контракта' },
  { id:'out',   name:'Логотип: угасание',   desc:'Заставка гаснет перед планетой' },
  { id:'cut',   name:'Склейка кадров',      desc:'Смена кадров планеты' },
  { id:'ping',  name:'Отметка',             desc:'Метка объекта, кадр «полушарие», конец брифинга' },
  { id:'hot',   name:'Тревога',             desc:'Метка противника или цели, заход в район, отказ от контракта' },
  { id:'sweep', name:'Развёртка карты',     desc:'Карта района проявляется после вступления' },
  { id:'drone', name:'Фоновый гул',         desc:'Тихий фон всего брифинга, файл играет по кругу', loop:true },
];
const MUSIC = [
  { id:'intro', name:'Вступление', desc:'С заставки заказчика и до перехода на карту' },
  { id:'brief', name:'Брифинг',    desc:'Карта района и реплики. Сменяет музыку вступления плавным переходом. Если не задана, дальше играет музыка вступления' },
];
function normSound(s) {
  s = Object.assign({ sfxVol:1, musicVol:.8, duck:true }, s);
  s.sfx = Object.assign({}, s.sfx); s.music = Object.assign({}, s.music);
  for (const d of SOUNDS) s.sfx[d.id] = Object.assign({ mode:'def', id:'', name:'', vol:1 }, s.sfx[d.id]);
  for (const m of MUSIC) s.music[m.id] = s.music[m.id] && s.music[m.id].id ? Object.assign({ name:'', vol:1, loop:true }, s.music[m.id]) : null;
  return s;
}
/* id файлов, которые реально используются (для экспорта и встроенного просмотра). */
function soundIds(sc) { const s = sc.sound, out = []; if (!s) return out;
  for (const d of SOUNDS) { const x = s.sfx[d.id]; if (x && x.mode === 'file' && x.id) out.push(x.id); }
  for (const m of MUSIC) { const x = s.music[m.id]; if (x && x.id) out.push(x.id); }
  return out; }

/* Стандартные синтезированные звуки. */
function Synth(ctx, out) {
  const tone = (freq, dur, vol = .04, type = 'square', slide = 0, delay = 0) => {
    const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + .03); };
  return {
    click:() => tone(1500, .04, .03),
    blip:() => tone(2100 + Math.random() * 500, .016, .01),
    open:() => { tone(220, .5, .05, 'triangle', 2); tone(660, .6, .03, 'sine', 0, .25); },
    out:() => { tone(880, 1.1, .03, 'sine', .4); tone(440, 1.2, .045, 'triangle', .5, .06); tone(1900, .03, .025); },
    cut:() => { tone(1900, .03, .03); tone(240, .12, .04, 'square', .5, .05); },
    ping:() => { tone(880, .3, .045, 'sine'); tone(1320, .4, .035, 'sine', 0, .09); },
    hot:() => { tone(430, .16, .035, 'square', .7); tone(430, .16, .035, 'square', .7, .18); },
    sweep:(dur = 2.4) => { const n = ctx.sampleRate * dur, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime; s.buffer = b;
      f.type = 'bandpass'; f.Q.value = 6; f.frequency.setValueAtTime(180, t); f.frequency.exponentialRampToValueAtTime(3200, t + dur);
      g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.09, t + .3); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(out); s.start(); },
    drone:() => { const f = ctx.createBiquadFilter(), g = ctx.createGain(), t = ctx.currentTime; f.type = 'lowpass'; f.frequency.value = 150;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.05, t + 4);
      const os = [55, 55.35, 82.4].map(fr => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(); return o; });
      f.connect(g); g.connect(out);
      return { stop(fade = .6) { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0, n + fade); os.forEach(o => o.stop(n + fade + .05)); } }; },
  };
}

/* Звуковой движок плеера и редактора: свои файлы или стандартный синтез, фоновый гул, музыка с переходами
   и приглушением под голос. */
class SoundEngine {
  constructor() { this.ctx = null; this.cfg = normSound(); this.bufs = new Map(); this.urls = new Map(); this.cur = null; this.drn = null; this.last = {}; this.muted = false; this.ducked = false; }
  ensure() {
    if (this.ctx) return this.ctx;
    try { const C = window.AudioContext || window.webkitAudioContext, c = new C(); this.ctx = c;
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : .55; this.master.connect(c.destination);
      this.sfx = c.createGain(); this.sfx.connect(this.master); this.mus = c.createGain(); this.mus.connect(this.master);
      this.syn = Synth(c, this.sfx); this.apply(true); } catch (e) { console.warn(e); this.ctx = null; }
    return this.ctx;
  }
  resume() { if (this.ensure() && this.ctx.state === 'suspended') this.ctx.resume(); }
  config(cfg) { this.cfg = normSound(cfg); this.apply(); }
  apply(now) { if (!this.ctx) return; const t = this.ctx.currentTime, mv = this.cfg.musicVol * (this.ducked ? .3 : 1);
    if (now) { this.sfx.gain.value = this.cfg.sfxVol; this.mus.gain.value = mv; return; }
    this.sfx.gain.setTargetAtTime(this.cfg.sfxVol, t, .05); this.mus.gain.setTargetAtTime(mv, t, this.ducked ? .12 : .5); }
  /* Подгружает файлы, на которые ссылается настройка звука. getBlob(id) → Blob | null. */
  async load(cfg, getBlob) {
    this.cfg = normSound(cfg); if (!this.ensure()) return;
    const jobs = [];
    for (const d of SOUNDS) { const sl = this.cfg.sfx[d.id]; if (sl.mode !== 'file' || !sl.id || this.bufs.has(sl.id)) continue;
      jobs.push((async () => { const b = await getBlob(sl.id); if (b) this.bufs.set(sl.id, await this.ctx.decodeAudioData(await b.arrayBuffer())); })()
        .catch(e => console.warn('Звук не загрузился:', d.name, e))); }
    for (const m of MUSIC) { const tr = this.cfg.music[m.id]; if (!tr || this.urls.has(tr.id)) continue;
      jobs.push((async () => { const b = await getBlob(tr.id); if (b) this.urls.set(tr.id, URL.createObjectURL(b)); })()
        .catch(e => console.warn('Музыка не загрузилась:', m.name, e))); }
    await Promise.all(jobs); this.apply();
  }
  forget(id) { this.bufs.delete(id); const u = this.urls.get(id); if (u) { URL.revokeObjectURL(u); this.urls.delete(id); } }
  /* Свой файл, стандартный синтез или тишина. Если файл не нашёлся — звучит стандартный. */
  play(key) {
    if (!this.ctx) return; const sl = this.cfg.sfx[key] || {};
    if (sl.mode === 'off') return;
    const b = sl.mode === 'file' && this.bufs.get(sl.id);
    if (b) { const now = this.ctx.currentTime; if (now - (this.last[key] || -1) < .035) return; this.last[key] = now;   // частые звуки не наслаиваются
      const s = this.ctx.createBufferSource(), g = this.ctx.createGain(); s.buffer = b; g.gain.value = sl.vol ?? 1; s.connect(g); g.connect(this.sfx); s.start(); return; }
    if (key !== 'drone' && this.syn[key]) this.syn[key]();
  }
  droneStart() {
    if (!this.ctx || this.drn) return; const sl = this.cfg.sfx.drone; if (sl.mode === 'off') return;
    const b = sl.mode === 'file' && this.bufs.get(sl.id);
    if (!b) { this.drn = this.syn.drone(); return; }
    const c = this.ctx, s = c.createBufferSource(), g = c.createGain(), t = c.currentTime; s.buffer = b; s.loop = true;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(sl.vol ?? 1, t + 3); s.connect(g); g.connect(this.sfx); s.start();
    this.drn = { stop(fade = .6) { const n = c.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(g.gain.value, n); g.gain.linearRampToValueAtTime(0, n + fade); s.stop(n + fade + .05); } };
  }
  droneStop(fade) { if (this.drn) { this.drn.stop(fade); this.drn = null; } }
  /* Включает дорожку which ('intro' | 'brief') с плавным переходом. false — такой дорожки нет. */
  music(which, fade = 2) {
    if (!this.ctx) return false; const tr = this.cfg.music[which], url = tr && this.urls.get(tr.id);
    if (!url) return false;
    if (this.cur && this.cur.which === which) return true;
    this.musicStop(fade);
    const c = this.ctx, el = new Audio(url), src = c.createMediaElementSource(el), g = c.createGain(), t = c.currentTime;
    el.loop = tr.loop !== false; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(tr.vol ?? 1, t + fade);
    src.connect(g); g.connect(this.mus); el.play().catch(e => console.warn('Музыка не запустилась', e));
    this.cur = { which, el, g }; return true;
  }
  musicStop(fade = 1.5) { const m = this.cur; if (!m || !this.ctx) return; this.cur = null; const n = this.ctx.currentTime;
    m.g.gain.cancelScheduledValues(n); m.g.gain.setValueAtTime(m.g.gain.value, n); m.g.gain.linearRampToValueAtTime(0, n + fade);
    setTimeout(() => { m.el.pause(); m.el.removeAttribute('src'); m.el.load(); }, fade * 1000 + 100); }
  musicVol(v) { if (this.cur) this.cur.g.gain.setTargetAtTime(v, this.ctx.currentTime, .1); }
  duck(on) { on = !!on && !!this.cfg.duck; if (on === this.ducked) return; this.ducked = on; this.apply(); }
  mute(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : .55; }
  stopAll() { this.musicStop(.3); this.droneStop(.3); }
}

/* =========================== сценарии =========================== */
function blankScenario() {
  const cid = uid('c');
  return normalize({
    version:1,
    meta:{ code:'01-A', title:'Новая операция', client:'Заказчик', clientNote:'описание заказчика', emblem:'hex', sector:'Сектор 1', speakerId:cid },
    cast:[{ id:cid, name:'Координатор', role:'Диспетчер заказчика', portrait:'' }],
    terrain:{ biome:'plains', seed:Math.floor(Math.random() * 9999), relief:1 },
    objects:[],
    steps:[{ id:uid('s'), ch:'Канал', text:'Пилот, на связи координатор. Начинаем брифинг.', cam:{ mode:'point', x:0, z:0, dist:280, pitch:58, yaw:-20 }, focus:0, hold:2.6 }],
    contract:{ title:'Задача операции', rows:[['ЗАКАЗЧИК', 'Заказчик'], ['РАЙОН', 'Сектор 1']], objectives:[{ text:'Основная задача', main:true }], rewards:[['Базовая выплата', '50 000 cr']] },
    planet:null,
  });
}
function defaultScenario() {
  const O = (type, x, z, extra) => Object.assign(makeObject(type, x, z), extra);
  const steps = [
    { id:'s0', ch:'Канал',   text:'Пилот, на связи координатор «Гелион-Экстракт». Брифинг короткий, повторять не будем.', cam:{ mode:'point', x:0, z:8, dist:300, pitch:60, yaw:-20 }, focus:320 },
    { id:'s1', ch:'Район',   text:'Район операции — плато Тессера, сектор семь. До прошлой недели здесь работал наш карьер «Гелион-7».', cam:{ mode:'point', x:34, z:34, dist:205, pitch:52, yaw:-38 }, focus:90 },
    { id:'s2', ch:'Цель',    text:'Три дня назад сектор заняла группировка «Чёрный тис». На плато они поставили узел ретрансляции и глушат нашу связь по всему району.', cam:{ mode:'object', target:'relay', dist:125, pitch:60, yaw:24 }, focus:42 },
    { id:'s3', ch:'Охрана',  text:'Узел прикрывают две огневые точки на северном гребне и патрули. Сектора обстрела закрывают северный подход к плато.', cam:{ mode:'point', x:8, z:-58, dist:175, pitch:47, yaw:-68 }, focus:85 },
    { id:'s4', ch:'Маршрут', text:'Высадка у южного склона. Идите по руслу высохшей реки: оно ниже линии огня и выводит прямо на плато.', cam:{ mode:'follow', target:'route', dist:175, pitch:50, yaw:-52 }, focus:55 },
    { id:'s5', ch:'Задача',  text:'Задача — уничтожить узел. Огневые точки — на ваше усмотрение: за каждую подавленную заплатим сверху.', cam:{ mode:'object', target:'relay', dist:110, pitch:50, yaw:72 }, focus:48 },
    { id:'s6', ch:'Конец',   text:'Это всё. Канал закроется через шестьдесят секунд. Ждём вашего решения.', cam:{ mode:'point', x:0, z:-6, dist:250, pitch:44, yaw:16 }, focus:320 },
  ];
  return normalize({
    version:1,
    meta:{ code:'07-C', title:'Узел ретрансляции «Кассиопея»', client:'Гелион-Экстракт', clientNote:'горнодобывающий консорциум · сектор Тессера', emblem:'hex', sector:'Сектор 7 · Тессера', speakerId:'c1' },
    cast:[{ id:'c1', name:'Координатор · Гелион-Экстракт', role:'Диспетчер заказчика', portrait:'' }],
    terrain:{ biome:'tessera', seed:7, relief:1 },
    objects:[
      O('dryriver', 6, 22, { id:'bed', name:'Сухое русло', pts:clone(TESSERA.route).slice(0, 5).reverse(), width:16, depth:8 }),
      O('relay', 22, -12, { id:'relay', mark:'s2' }),
      O('turret', -18, -80, { id:'turA', name:'Огневая точка A', mark:'s3' }),
      O('turret', 34, -84, { id:'turB', name:'Огневая точка B', mark:'s3' }),
      O('mech', 46, -36, { id:'patA', name:'Патруль', show:'s3', mark:'s3', wp:[[56, -26], [66, -36], [56, -46]], loop:true }),
      O('infantry', -48, -22, { id:'patB', name:'Пехота', show:'s3', mark:'s3', count:6, wp:[[-28, -24], [-30, -38]], loop:false }),
      O('cmd', 44, 62, { id:'quarry', name:'Карьер «Гелион-7»', tag:'Объект заказчика', rot:17, mark:'s1' }),
      O('silo', 38, 52, { label:false, mark:'never' }),
      O('hangar', 98, 44, { rot:-30, label:false, mark:'never' }),
      O('habitat', 84, 90, { rot:20, label:false, mark:'never' }),
      O('zone', 0, 0, { id:'ao', name:'Зона операции', radius:112, show:'s1', mark:'s1' }),
      O('lz', -22, 118, { id:'lz', show:'s4', mark:'s4', meta:'START' }),
      O('route', -22, 118, { id:'route', name:'Русло', label:false, show:'s4', mark:'s4', pts:clone(TESSERA.route) }),
    ],
    steps,
    contract:{
      title:'Уничтожить узел ретрансляции',
      rows:[['ЗАКАЗЧИК', 'Гелион-Экстракт'], ['РАЙОН', 'Плато Тессера, с. 7'], ['ПРОТИВНИК', '«Чёрный тис»']],
      objectives:[{ text:'Уничтожить узел ретрансляции', main:true }, { text:'Подавить огневые точки — 0 / 2', main:false }],
      rewards:[['Базовая выплата', '84 000 cr'], ['Огневая точка ×2', '+12 000 cr'], ['Ремонт и боезапас', 'за счёт пилота']],
    },
    planet:{ show:true, name:'Тессера', designation:'HX-4471 b', type:'desert', seed:4471, lat:18, lon:-34, tilt:-18, light:{ angle:140, dist:.3 }, region:'Плато Тессера · сектор 7',
      desc:'Сухой каменистый мир на окраине освоенного космоса. Атмосфера разрежена, но пригодна для работы в масках. Недра богаты тяжёлыми металлами — ради них здесь и стоят карьеры консорциумов.',
      stats:[['Радиус', '5 210 км'], ['Гравитация', '0,82 g'], ['Атмосфера', 'разреженная, азот-аргон'], ['Температура', '−40…+38 °C'], ['Население', '≈ 210 тыс.']] },
  });
}
/* Дополняет недостающие поля — сценарий из файла может быть старым или неполным. */
function normalize(sc) {
  sc = sc || {};
  sc.version = 1;
  sc.meta = Object.assign({ code:'', title:'', client:'', clientNote:'', emblem:'hex', sector:'', speakerId:'' }, sc.meta);
  if (!Array.isArray(sc.cast) || !sc.cast.length) { const id = uid('c'); sc.cast = [{ id, name:sc.meta.speaker || 'Координатор', role:'', portrait:'' }]; if (!sc.meta.speakerId) sc.meta.speakerId = id; }
  // characterId — персонаж каталога студии; image и frame — его картинка и кадр (frame.inherit — как в каталоге)
  sc.cast = sc.cast.map(c => Object.assign({ id:uid('c'), name:'', role:'', portrait:'', characterId:null, image:'', frame:null }, c));
  if (!sc.cast.some(c => c.id === sc.meta.speakerId)) sc.meta.speakerId = sc.cast[0].id;
  delete sc.meta.speaker;
  sc.terrain = Object.assign({ biome:'plains', seed:1, relief:1 }, sc.terrain);
  sc.objects = (sc.objects || []).filter(o => CATALOG[o.type]).map(o => {
    const d = CATALOG[o.type], base = makeObject(o.type, o.x || 0, o.z || 0); delete base.id;
    const r = Object.assign(base, o); r.id = r.id || uid(); if (d.path && (!r.pts || !r.pts.length)) r.pts = [[r.x, r.z]]; return r; });
  sc.steps = (sc.steps || []).map(s => Object.assign({ id:uid('s'), ch:'', speakerId:'', speaker:'', text:'', cam:{ mode:'point', x:0, z:0, dist:260, pitch:55, yaw:0 }, focus:0, hold:2.6, voice:null }, s));
  sc.steps.forEach(s => { s.id = s.id || uid('s'); s.cam = Object.assign({ mode:'point', x:0, z:0, dist:260, pitch:55, yaw:0 }, s.cam); });
  sc.contract = Object.assign({ title:'', rows:[], objectives:[], rewards:[] }, sc.contract);
  if (sc.planet) { sc.planet = Object.assign({ show:true, name:'', designation:'', type:'terran', seed:1, lat:0, lon:0, tilt:0, region:'', desc:'', stats:[] }, sc.planet);
    sc.planet.light = Object.assign({ angle:135, dist:.28 }, sc.planet.light); }
  sc.sound = normSound(sc.sound);
  return sc;
}
/* База из сценария (или генерация) + модификаторы объектов. */
function terrainFrom(sc, hf) { if (!(sc.terrain.data && hf.decode(sc.terrain.data))) hf.generate(sc.terrain.biome, sc.terrain.seed, sc.terrain.relief); hf.compose(sc.objects); }

/* Центр кадра для шага: объект (в т.ч. движущийся отряд), маршрут (по прогрессу), точка. */
function stepCenter(W, st, followP = 0) {
  const c = st.cam || {};
  if ((c.mode === 'object' || c.mode === 'follow') && c.target) {
    const e = W.ents.get(c.target);
    if (e) { if (c.mode === 'follow' && e.def.kind === 'route') return W.routePoint(e, followP * .92 + .04); return W.entityPos(e); }
  }
  return new THREE.Vector3(c.x || 0, W.hf.sample(c.x || 0, c.z || 0), c.z || 0);
}
function stepFocus(st) { const c = st.cam || {}; if (st.focus > 0) return st.focus; if (c.mode === 'follow') return 55; return Math.max(40, (c.dist || 260) * .45); }
/* Положение камеры шага по центру и сферическим углам. */
function camPos(center, c, out = new THREE.Vector3()) { const pr = c.pitch * DEG, ar = c.yaw * DEG;
  return out.set(center.x + Math.sin(ar) * Math.sin(pr) * c.dist, center.y + Math.cos(pr) * c.dist, center.z + Math.cos(ar) * Math.sin(pr) * c.dist); }

return { THREE, DEG, UNIT_M, SIZE, GRID, RMAX, STORAGE_KEY, COL, C, SIDES, BIOMES, CATS, CATALOG, P, ICON, EMBLEMS, DOME_COLORS,
  ss, uid, clone, elv, makeNoise, smoothPath, randomPath, Heightfield, World, MarkerLayer, makeObject, blankScenario, defaultScenario, normalize, terrainFrom,
  hasPad, affectsTerrain, stepCenter, stepFocus, camPos, valOf, dashMat, lineMat, lineGeo,
  portraitPlaceholder, downscalePortrait, speakerOf, AudioStore, blobToDataURL, dataURLToBlob,
  SOUNDS, MUSIC, normSound, soundIds, Synth, SoundEngine,
  applyPortrait, portraitKey, setAssetResolver, assetUrl, isServerRef, getAudioBlob, setPalette };
};
})();
