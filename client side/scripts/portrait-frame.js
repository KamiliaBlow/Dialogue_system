// Портрет в рамке канала терминала — одна формула для терминала и студии.
//
// Терминал рисует портрет фоном рамки (#char-1 / #char-2):
//   ширина картинки = scale × ширина рамки (background-size: scale×100%);
//   смещение — от левого верхнего угла рамки;
//   отражение — scaleX(-1) всей рамки.
// Смещение хранится в долях ШИРИНЫ рамки по обеим осям (xRel, yRel): картинка
// масштабируется от ширины, поэтому при любой рамке картинка и смещение меняются вместе,
// а меняется только видимая высота кадра.
//
// Серверная пара: server side/utils/portrait.js (те же константы).

export const BASE_FRAME = Object.freeze({ width: 258, height: 319 });

function finiteOr(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

// Нормализует портрет из любых полей сервера: {portraitScale, portraitXRel, ...},
// строки БД {portrait_scale, portrait_x_rel, ...} или старые пиксели без долей.
export function readPortrait(source) {
    const s = source || {};
    const pick = (...keys) => {
        for (const k of keys) if (s[k] !== undefined && s[k] !== null && s[k] !== '') return s[k];
        return undefined;
    };
    const scale = finiteOr(pick('portraitScale', 'portrait_scale', 'gc_portrait_scale', 'scale'), 1) || 1;
    const xRelRaw = pick('portraitXRel', 'portrait_x_rel', 'gc_portrait_x_rel', 'xRel');
    const yRelRaw = pick('portraitYRel', 'portrait_y_rel', 'gc_portrait_y_rel', 'yRel');
    const xPx = finiteOr(pick('portraitX', 'portrait_x', 'gc_portrait_x'), 0);
    const yPx = finiteOr(pick('portraitY', 'portrait_y', 'gc_portrait_y'), 0);
    const mirrorRaw = pick('portraitMirror', 'portrait_mirror', 'gc_portrait_mirror', 'mirror');
    return {
        scale,
        xRel: xRelRaw !== undefined ? finiteOr(xRelRaw, 0) : xPx / BASE_FRAME.width,
        yRel: yRelRaw !== undefined ? finiteOr(yRelRaw, 0) : yPx / BASE_FRAME.width,
        mirror: mirrorRaw === true || mirrorRaw === 1 || mirrorRaw === '1'
    };
}

// CSS для рамки шириной frameWidth (px в системе координат самой рамки).
export function portraitCss(portrait, frameWidth = BASE_FRAME.width) {
    const p = portrait || { scale: 1, xRel: 0, yRel: 0, mirror: false };
    const round = v => Math.round(v * 100) / 100;
    return {
        backgroundSize: `${round(p.scale * 100)}%`,
        backgroundPosition: `${round(p.xRel * frameWidth)}px ${round(p.yRel * frameWidth)}px`,
        transform: p.mirror ? 'scaleX(-1)' : 'none'
    };
}

// Ширина рамки в её собственных CSS-пикселях. getComputedStyle не зависит от zoom
// (масштаб интерфейса), поэтому смещение совпадает при любом масштабе.
export function frameWidthOf(element) {
    if (!element) return BASE_FRAME.width;
    const width = parseFloat(getComputedStyle(element).width);
    return Number.isFinite(width) && width > 0 ? width : BASE_FRAME.width;
}

const applied = new WeakMap();

// Применить портрет к рамке. null — снять настройки (например, для помех static.gif).
export function applyPortrait(element, portrait) {
    if (!element) return;
    if (!portrait) {
        applied.delete(element);
        element.style.backgroundSize = '';
        element.style.backgroundPosition = '';
        element.style.transform = '';
        return;
    }
    applied.set(element, portrait);
    const css = portraitCss(portrait, frameWidthOf(element));
    element.style.backgroundSize = css.backgroundSize;
    element.style.backgroundPosition = css.backgroundPosition;
    element.style.transform = css.transform;
}

// Пересчитать смещение после смены размера рамки (поворот экрана, другой медиазапрос).
export function reapplyPortrait(element) {
    if (element && applied.has(element)) applyPortrait(element, applied.get(element));
}

// Следить за размером рамки и пересчитывать смещение автоматически.
export function watchFrame(element) {
    if (!element || typeof ResizeObserver === 'undefined') return () => {};
    let last = 0;
    const observer = new ResizeObserver(() => {
        const width = frameWidthOf(element);
        if (Math.abs(width - last) < 0.5) return;
        last = width;
        reapplyPortrait(element);
    });
    observer.observe(element);
    return () => observer.disconnect();
}
