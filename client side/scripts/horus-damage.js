/* Повреждения корпуса для темы HORUS: трещины, сквозь которые видна плата, пробоины
 * с микросхемой, торчащие провода с оголённой медью, сорванные винты, царапины.
 * Каждая загрузка страницы — свой набор: у каждого терминала повстанцев свои шрамы.
 *
 * Слой — один SVG на весь экран за панелями. Холст берёт пропорции окна в момент загрузки
 * (чтобы края не срезались), повреждения кучкуются у краёв, где фон не закрыт пультом.
 * Включается сам, когда у <body> есть класс theme-horus (тема может прийти позже,
 * после ответа сервера, или смениться в досье), и убирается при смене темы.
 * Набор генерируется один раз за загрузку: вернувшись к HORUS, видишь те же шрамы.
 */
(function () {
    'use strict';

    const LAYER_ID = 'horus-damage';
    // Ширина холста в единицах SVG: на мониторе 1920, на узком экране меньше —
    // иначе провода и микросхемы на телефоне становятся нитками.
    let W = 1920;
    let H = 1080;
    function measure() {
        const vw = Math.max(320, window.innerWidth || 1920);
        const vh = Math.max(320, window.innerHeight || 1080);
        W = vw >= 1200 ? 1920 : Math.max(700, Math.round(vw * 1.6));
        H = Math.round(W * vh / vw);
    }
    let layer = null;
    let uid = 0;

    const rand = (a, b) => a + Math.random() * (b - a);
    const randInt = (a, b) => Math.floor(rand(a, b + 1));
    const pick = list => list[Math.floor(Math.random() * list.length)];
    const chance = p => Math.random() < p;
    const r1 = v => Math.round(v * 10) / 10;
    const pts = list => list.map(p => `${r1(p[0])},${r1(p[1])}`).join(' ');
    const id = name => `hd-${name}-${++uid}`;

    // Где фон виден: полосы у краёв (доли холста). Пульт стоит по центру и закрывает середину.
    const ZONES = [
        { w: 4, x: [0.03, 0.2], y: [0.08, 0.92] },   // слева
        { w: 4, x: [0.8, 0.97], y: [0.08, 0.92] },   // справа
        { w: 1, x: [0.12, 0.88], y: [0.02, 0.1] },   // сверху
        { w: 1, x: [0.12, 0.88], y: [0.9, 0.98] }    // снизу
    ];
    function spot() {
        const total = ZONES.reduce((s, z) => s + z.w, 0);
        let roll = Math.random() * total;
        const zone = ZONES.find(z => (roll -= z.w) < 0) || ZONES[0];
        return [rand(zone.x[0], zone.x[1]) * W, rand(zone.y[0], zone.y[1]) * H];
    }

    // ---------- плата, которую видно сквозь трещины ----------
    function pcbPattern(patternId) {
        const size = 240;
        const step = 12;
        const parts = [`<rect width="${size}" height="${size}" fill="#03130a"/>`];
        for (let k = 0; k < 13; k++) {
            let x = randInt(0, size / step) * step;
            let y = randInt(0, size / step) * step;
            const path = [[x, y]];
            for (let s = 0; s < randInt(2, 5); s++) {
                const dir = pick([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1]]);
                const len = randInt(2, 7) * step;
                x += dir[0] * len;
                y += dir[1] * len;
                path.push([x, y]);
            }
            parts.push(`<polyline points="${pts(path)}" fill="none" stroke="#1b8f52" stroke-opacity="0.6" stroke-width="${pick([1.5, 2, 3])}" stroke-linejoin="round"/>`);
            [path[0], path[path.length - 1]].forEach(p => {
                parts.push(`<circle cx="${p[0]}" cy="${p[1]}" r="3.6" fill="#b48a3c"/><circle cx="${p[0]}" cy="${p[1]}" r="1.4" fill="#03130a"/>`);
            });
        }
        for (let k = 0; k < 6; k++) {
            parts.push(`<circle cx="${r1(rand(0, size))}" cy="${r1(rand(0, size))}" r="2" fill="none" stroke="#b48a3c" stroke-opacity="0.8"/>`);
        }
        ['R12', 'C7', 'U3', 'HX-7F', 'Q4', 'L2'].forEach(label => {
            if (chance(0.6)) {
                parts.push(`<text x="${r1(rand(8, size - 30))}" y="${r1(rand(12, size - 6))}" fill="#cfe8d8" fill-opacity="0.35" font-family="monospace" font-size="8">${label}</text>`);
            }
        });
        return `<pattern id="${patternId}" patternUnits="userSpaceOnUse" width="${size}" height="${size}" patternTransform="rotate(${r1(rand(-8, 8))})">${parts.join('')}</pattern>`;
    }

    // ---------- трещина: рваная щель от края или изнутри, с ответвлениями ----------
    function crack(pcb) {
        const start = spot();
        let angle = rand(0, Math.PI * 2);
        const line = [start];
        const segments = randInt(7, 14);
        for (let s = 0; s < segments; s++) {
            angle += rand(-0.6, 0.6);
            const last = line[line.length - 1];
            const len = rand(18, 55);
            line.push([last[0] + Math.cos(angle) * len, last[1] + Math.sin(angle) * len]);
        }
        const maxW = rand(7, 17);
        const left = [];
        const right = [];
        line.forEach((p, i) => {
            const next = line[Math.min(i + 1, line.length - 1)];
            const prev = line[Math.max(i - 1, 0)];
            const a = Math.atan2(next[1] - prev[1], next[0] - prev[0]) + Math.PI / 2;
            const t = i / (line.length - 1);
            const w = maxW * Math.pow(1 - t, 0.8) * rand(0.5, 1.2) / 2;
            left.push([p[0] + Math.cos(a) * w * rand(0.6, 1.3), p[1] + Math.sin(a) * w * rand(0.6, 1.3)]);
            right.push([p[0] - Math.cos(a) * w * rand(0.6, 1.3), p[1] - Math.sin(a) * w * rand(0.6, 1.3)]);
        });
        const gap = left.concat(right.reverse());
        const out = [
            `<polygon points="${pts(gap)}" fill="none" stroke="#000" stroke-opacity="0.65" stroke-width="3" stroke-linejoin="round"/>`,
            `<polygon points="${pts(gap)}" fill="url(#${pcb})"/>`,
            `<polygon points="${pts(gap)}" fill="none" stroke="#bfeccf" stroke-opacity="0.42" stroke-width="1.1" stroke-linejoin="round"/>`
        ];
        for (let b = 0; b < randInt(1, 4); b++) {
            const from = line[randInt(1, line.length - 2)];
            let a = angle + rand(-1.6, 1.6);
            const branch = [from];
            for (let s = 0; s < randInt(2, 5); s++) {
                a += rand(-0.5, 0.5);
                const last = branch[branch.length - 1];
                const len = rand(10, 34);
                branch.push([last[0] + Math.cos(a) * len, last[1] + Math.sin(a) * len]);
            }
            out.push(`<polyline points="${pts(branch)}" fill="none" stroke="#bfeccf" stroke-opacity="0.3" stroke-width="1"/>`);
        }
        return { svg: out.join(''), ends: [line[0], line[Math.floor(line.length / 2)]] };
    }

    // ---------- пробоина: осколочный край, внутри плата и микросхема ----------
    function hole(pcb) {
        const [cx, cy] = spot();
        const R = rand(48, 105);
        const corners = [];
        const n = randInt(9, 14);
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + rand(-0.2, 0.2);
            const r = R * rand(0.55, 1.15);
            corners.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
        }
        const clip = id('hole');
        const chipW = R * rand(0.75, 1.05);
        const chipH = R * rand(0.45, 0.6);
        const tilt = rand(-25, 25);
        const pins = [];
        const pinCount = randInt(5, 9);
        for (let p = 0; p < pinCount; p++) {
            const px = -chipW / 2 + (p + 0.5) * (chipW / pinCount) - 2;
            pins.push(`<rect x="${r1(px)}" y="${r1(-chipH / 2 - 6)}" width="4" height="6" fill="#9a9a96"/>`);
            pins.push(`<rect x="${r1(px)}" y="${r1(chipH / 2)}" width="4" height="6" fill="#9a9a96"/>`);
        }
        const label = pick(['H0-7F3A', 'NHP//?', 'OMNI-RX', 'PG-13Δ', 'XK-0451', 'H-PATTERN']);
        const chip = `<g transform="translate(${r1(cx + rand(-R, R) * 0.2)} ${r1(cy + rand(-R, R) * 0.2)}) rotate(${r1(tilt)})">
            ${pins.join('')}
            <rect x="${r1(-chipW / 2)}" y="${r1(-chipH / 2)}" width="${r1(chipW)}" height="${r1(chipH)}" rx="2" fill="#0b0d0c" stroke="#2a2d2b"/>
            <circle cx="${r1(-chipW / 2 + 7)}" cy="${r1(-chipH / 2 + 7)}" r="2.5" fill="#1c1f1d"/>
            <text x="0" y="4" text-anchor="middle" fill="#dfe6e2" fill-opacity="0.45" font-family="monospace" font-size="${r1(Math.max(7, chipH * 0.28))}">${label}</text>
        </g>`;
        const extras = [];
        if (chance(0.7)) {
            const ex = cx + rand(-R, R) * 0.6;
            const ey = cy + rand(-R, R) * 0.6;
            extras.push(`<circle cx="${r1(ex)}" cy="${r1(ey)}" r="${r1(rand(6, 11))}" fill="#1d3a5c" stroke="#0d1a2a" stroke-width="2"/><circle cx="${r1(ex)}" cy="${r1(ey)}" r="2" fill="#c9cdd2" fill-opacity="0.6"/>`);
        }
        const radial = [];
        for (let k = 0; k < randInt(4, 8); k++) {
            const a = rand(0, Math.PI * 2);
            const r0 = R * rand(0.8, 1.1);
            const r2 = r0 + rand(25, 120);
            const mid = (r0 + r2) / 2;
            const bend = rand(-0.12, 0.12);
            radial.push(`<polyline points="${pts([
                [cx + Math.cos(a) * r0, cy + Math.sin(a) * r0],
                [cx + Math.cos(a + bend) * mid, cy + Math.sin(a + bend) * mid],
                [cx + Math.cos(a - bend) * r2, cy + Math.sin(a - bend) * r2]
            ])}" fill="none" stroke="#bfeccf" stroke-opacity="0.2" stroke-width="0.9"/>`);
        }
        const svg = `<clipPath id="${clip}"><polygon points="${pts(corners)}"/></clipPath>
            ${radial.join('')}
            <polygon points="${pts(corners)}" fill="url(#${pcb})"/>
            <g clip-path="url(#${clip})">${chip}${extras.join('')}
                <polygon points="${pts(corners)}" fill="none" stroke="#000" stroke-opacity="0.7" stroke-width="14" stroke-linejoin="round"/>
            </g>
            <polygon points="${pts(corners)}" fill="none" stroke="#bfeccf" stroke-opacity="0.32" stroke-width="1.2" stroke-linejoin="round"/>`;
        return { svg, ends: [[cx, cy]] };
    }

    // ---------- провода: пучок свисает из пробоины, трещины или из-за края ----------
    const INSULATION = ['#7a1f2b', '#a8841c', '#1f4f7a', '#262626', '#1c6b3a', '#b9b2a0', '#5a2a6e'];
    function bundle(from) {
        const out = [];
        const count = randInt(2, 4);
        const side = from[0] < W / 2 ? 1 : -1;
        const spark = chance(0.45);
        for (let w = 0; w < count; w++) {
            const s = [from[0] + rand(-8, 8), from[1] + rand(-8, 8)];
            const dx = side * rand(30, 220) * (chance(0.25) ? -1 : 1);
            const e = [s[0] + dx, s[1] + rand(60, 260)];
            const c1 = [s[0] + dx * rand(0.2, 0.6), s[1] - rand(10, 60)];
            const c2 = [e[0] - dx * rand(0, 0.3), e[1] - rand(40, 120)];
            const d = `M${r1(s[0])} ${r1(s[1])}C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(e[0])} ${r1(e[1])}`;
            const width = rand(3.5, 6);
            const color = pick(INSULATION);
            out.push(`<path d="${d}" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="${r1(width + 2.4)}" stroke-linecap="round"/>`);
            out.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${r1(width)}" stroke-linecap="round"/>`);
            out.push(`<path d="${d}" fill="none" stroke="#fff" stroke-opacity="0.13" stroke-width="1" stroke-linecap="round" transform="translate(-1 -1)"/>`);
            // Оголённая медь на конце: несколько разлохмаченных жил.
            const dir = Math.atan2(e[1] - c2[1], e[0] - c2[0]);
            for (let k = 0; k < 3; k++) {
                const a = dir + rand(-0.35, 0.35);
                const len = rand(7, 15);
                out.push(`<line x1="${r1(e[0])}" y1="${r1(e[1])}" x2="${r1(e[0] + Math.cos(a) * len)}" y2="${r1(e[1] + Math.sin(a) * len)}" stroke="#c87533" stroke-width="1.3" stroke-linecap="round"/>`);
            }
            if (spark && w === 0) {
                const sx = e[0] + Math.cos(dir) * 14;
                const sy = e[1] + Math.sin(dir) * 14;
                const rays = [];
                for (let k = 0; k < 5; k++) {
                    const a = rand(0, Math.PI * 2);
                    const len = rand(4, 12);
                    rays.push(`<line x1="${r1(sx)}" y1="${r1(sy)}" x2="${r1(sx + Math.cos(a) * len)}" y2="${r1(sy + Math.sin(a) * len)}"/>`);
                }
                out.push(`<g class="hd-spark" style="animation-delay:${r1(rand(0, 6))}s;animation-duration:${r1(rand(3.5, 7))}s" stroke="${pick(['#ff2e88', '#fff4c2', '#3dff9a'])}" stroke-width="1.4" stroke-linecap="round">${rays.join('')}<circle cx="${r1(sx)}" cy="${r1(sy)}" r="2.2" fill="#fff" stroke="none"/></g>`);
            }
        }
        // Стяжка или виток изоленты на пучке.
        if (chance(0.6)) {
            const t = [from[0] + side * rand(10, 30), from[1] + rand(5, 25)];
            out.push(`<rect x="${r1(t[0] - 9)}" y="${r1(t[1] - 4)}" width="18" height="8" rx="1.5" fill="${chance(0.5) ? '#d9c85a' : '#202322'}" fill-opacity="0.9" transform="rotate(${r1(rand(-40, 40))} ${r1(t[0])} ${r1(t[1])})"/>`);
        }
        return out.join('');
    }

    // ---------- мелочи: винты (часть сорвана), царапины, заплатка изолентой ----------
    function screws() {
        const out = [];
        for (let k = 0; k < randInt(3, 6); k++) {
            const [x, y] = spot();
            if (chance(0.4)) {
                out.push(`<circle cx="${r1(x)}" cy="${r1(y)}" r="5" fill="#010302"/><circle cx="${r1(x)}" cy="${r1(y)}" r="5" fill="none" stroke="#bfeccf" stroke-opacity="0.18"/>`);
            } else {
                const a = rand(0, 180);
                out.push(`<g transform="rotate(${r1(a)} ${r1(x)} ${r1(y)})"><circle cx="${r1(x)}" cy="${r1(y)}" r="5.5" fill="#1a1f1c" stroke="#3a423d"/><line x1="${r1(x - 3.5)}" y1="${r1(y)}" x2="${r1(x + 3.5)}" y2="${r1(y)}" stroke="#050806" stroke-width="1.6"/></g>`);
            }
        }
        return out.join('');
    }

    function scratches() {
        const out = [];
        for (let k = 0; k < randInt(5, 10); k++) {
            const [x, y] = spot();
            const a = rand(0, Math.PI);
            const len = rand(40, 180);
            out.push(`<line x1="${r1(x)}" y1="${r1(y)}" x2="${r1(x + Math.cos(a) * len)}" y2="${r1(y + Math.sin(a) * len)}" stroke="#bfeccf" stroke-opacity="${r1(rand(0.05, 0.12) * 100) / 100}" stroke-width="${pick([0.6, 0.8, 1])}"/>`);
        }
        return out.join('');
    }

    function tapePatch(at) {
        const [x, y] = at;
        return `<rect x="${r1(x - 34)}" y="${r1(y - 9)}" width="68" height="18" fill="#d9c85a" fill-opacity="0.82" transform="rotate(${r1(rand(-35, 35))} ${r1(x)} ${r1(y)})"/>`;
    }

    function build() {
        measure();
        const pcb = id('pcb');
        const parts = [];
        const anchors = [];

        parts.push(scratches());
        for (let k = 0; k < randInt(1, 2); k++) {
            const h = hole(pcb);
            parts.push(h.svg);
            anchors.push(...h.ends);
        }
        for (let k = 0; k < randInt(2, 4); k++) {
            const c = crack(pcb);
            parts.push(c.svg);
            anchors.push(c.ends[1]);
            if (chance(0.3)) parts.push(tapePatch(c.ends[0]));
        }
        parts.push(screws());

        // Провода: из пробоин и трещин, иногда — просто из-за края экрана.
        for (let k = 0; k < randInt(2, 3); k++) {
            const from = chance(0.75) && anchors.length
                ? anchors.splice(Math.floor(Math.random() * anchors.length), 1)[0]
                : [chance(0.5) ? -10 : W + 10, rand(0.1, 0.5) * H];
            parts.push(bundle(from));
        }

        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.id = LAYER_ID;
        svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid slice');
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        svg.innerHTML = `<defs>${pcbPattern(pcb)}</defs>${parts.join('')}`;
        return svg;
    }

    function injectStyle() {
        if (document.getElementById(`${LAYER_ID}-style`)) return;
        const style = document.createElement('style');
        style.id = `${LAYER_ID}-style`;
        style.textContent = `
#${LAYER_ID} { position: fixed; inset: 0; width: 100%; height: 100%; z-index: 1; pointer-events: none; opacity: 0.88; }
#${LAYER_ID} .hd-spark { opacity: 0; animation: hdSpark 5s steps(1, end) infinite; }
@keyframes hdSpark { 0%, 90%, 94%, 100% { opacity: 0; } 91% { opacity: 1; } 92% { opacity: 0.2; } 93% { opacity: 0.9; } }
@media (prefers-reduced-motion: reduce) { #${LAYER_ID} .hd-spark { animation: none; } }
@media print { #${LAYER_ID} { display: none; } }`;
        document.head.appendChild(style);
    }

    function sync() {
        const on = document.body.classList.contains('theme-horus');
        const mounted = layer && layer.isConnected;
        if (on && !mounted) {
            injectStyle();
            if (!layer) layer = build();
            // Над фоном и виньеткой, под развёрткой ЭЛТ и пультом.
            const anchor = document.querySelector('body > .vignette') || document.querySelector('body > .bg-grid');
            if (anchor) anchor.after(layer);
            else document.body.prepend(layer);
        } else if (!on && mounted) {
            layer.remove();
        }
    }

    function start() {
        sync();
        new MutationObserver(sync).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();

    window.HorusDamage = { regenerate() { if (layer) layer.remove(); layer = null; sync(); } };
})();
