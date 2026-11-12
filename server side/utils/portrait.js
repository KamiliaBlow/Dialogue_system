// Положение портрета в рамке канала терминала.
//
// Терминал рисует портрет фоном рамки: ширина картинки = scale × ширина рамки,
// смещение — от левого верхнего угла. Раньше смещение хранилось в пикселях и
// совпадало с задуманным только при базовом размере рамки (258×319 при 1920×1080).
// Теперь оно хранится в долях ШИРИНЫ рамки по обеим осям: картинка тоже масштабируется
// от ширины, поэтому при любой рамке картинка и смещение меняются вместе.
//
// Клиентская пара: client side/scripts/portrait-frame.js (те же константы и формула).

const BASE_FRAME_WIDTH = 258;
const BASE_FRAME_HEIGHT = 319;

function finiteOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

// Из тела запроса: новые поля portraitXRel / portraitYRel, иначе старые пиксели.
// Возвращает и доли, и пиксели базовой рамки (пиксели — для старых клиентов).
function portraitFromBody(body) {
    const b = body || {};
    const scale = Math.min(5, Math.max(0.1, finiteOr(b.portraitScale, 1)));
    const hasRel = b.portraitXRel !== undefined && b.portraitXRel !== '' && b.portraitYRel !== undefined && b.portraitYRel !== '';
    const xRel = hasRel ? finiteOr(b.portraitXRel, 0) : finiteOr(b.portraitX, 0) / BASE_FRAME_WIDTH;
    const yRel = hasRel ? finiteOr(b.portraitYRel, 0) : finiteOr(b.portraitY, 0) / BASE_FRAME_WIDTH;
    const clampRel = v => Math.min(5, Math.max(-5, v));
    const x = clampRel(xRel);
    const y = clampRel(yRel);
    return {
        scale,
        xRel: x,
        yRel: y,
        xPx: Math.round(x * BASE_FRAME_WIDTH * 100) / 100,
        yPx: Math.round(y * BASE_FRAME_WIDTH * 100) / 100,
        mirror: b.portraitMirror === '1' || b.portraitMirror === 1 || b.portraitMirror === true ? 1 : 0
    };
}

// Строка БД → поля для клиента. Если долей ещё нет (не прошла миграция) — считаем из пикселей.
function portraitForClient(row) {
    const r = row || {};
    const xRel = r.portrait_x_rel !== null && r.portrait_x_rel !== undefined
        ? Number(r.portrait_x_rel) : finiteOr(r.portrait_x, 0) / BASE_FRAME_WIDTH;
    const yRel = r.portrait_y_rel !== null && r.portrait_y_rel !== undefined
        ? Number(r.portrait_y_rel) : finiteOr(r.portrait_y, 0) / BASE_FRAME_WIDTH;
    return {
        portraitScale: finiteOr(r.portrait_scale, 1) || 1,
        portraitXRel: xRel,
        portraitYRel: yRel,
        portraitX: finiteOr(r.portrait_x, 0),
        portraitY: finiteOr(r.portrait_y, 0),
        portraitMirror: Number(r.portrait_mirror) === 1
    };
}

module.exports = { BASE_FRAME_WIDTH, BASE_FRAME_HEIGHT, portraitFromBody, portraitForClient };
