// Разбор текста реплики так, как его печатает терминал. Общий для терминала (dialogue.js, typeText)
// и студии (кнопка «Авто» у скорости печати), чтобы расчёт совпадал с реальной печатью.
//
// Разметка реплики:
//   [2s], [0.5s]              — пауза перед следующим символом (в конце текста не выдерживается);
//   [Shake]…[ShakeE]          — тряска;
//   [Color:Red]…[ColorE]      — цвет;
//   [S:1.2]…[SE]              — размер (0.8–1.3);
//   [GLITCH_START] и др.       — эффекты помех (терминал убирает их до печати).
// Печатается каждый оставшийся символ (вместе с пробелами и переводами строк) через одну
// и ту же задержку «скорость ± 5 мс»; после знаков препинания — дольше (PUNCTUATION_DELAYS),
// паузы [Ns] добавляются к ней.

// Добавка к задержке, мс: терминал держит её перед символом, который идёт через один после знака
// (задержка символа i растёт, если знак — символ i − 1). Так запятая и точка звучат паузой.
export const PUNCTUATION_DELAYS = Object.freeze({ '.': 350, '!': 300, '?': 300, ':': 250, ';': 250, ',': 150 });

export function punctuationDelay(prevChar) {
    return PUNCTUATION_DELAYS[prevChar] || 0;
}

export const GLITCH_MARKERS = Object.freeze(['[GLITCH_START]', '[GLITCH_STRONG]', '[GLITCH_CRITICAL]', '[GLITCH_END]']);

// Как в терминале: убирается первое вхождение каждого маркера.
export function stripGlitchMarkers(text) {
    let clean = String(text || '');
    GLITCH_MARKERS.forEach(marker => { clean = clean.replace(marker, ''); });
    return clean;
}

/**
 * Значение цвета для атрибута style: hex, rgb()/rgba() с числами или имя цвета.
 * Всё прочее (url(), expression, точки с запятой) отклоняется.
 */
export function sanitizeColor(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const v = raw.trim();
    if (!v) return null;
    if (/^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) return v;
    if (/^rgba?\(\s*[\d.,%\s]+\s*\)$/i.test(v)) return v;
    if (/^[a-zA-Z-]+$/.test(v)) return v;
    return null;
}

/**
 * Разбор за один проход: разметка и паузы снимаются вместе, поэтому пауза привязана
 * к печатаемому символу. (Раньше паузы считались по тексту с разметкой, а печать — без неё,
 * и пауза после [Shake]…[ShakeE] или [Color:…] сдвигалась или терялась.)
 *
 * @param {string} text — текст без маркеров помех
 * @returns {{ segments: Array<{char: string, style: object}>, pauses: number[], plain: string, trailingPause: number }}
 *   pauses[i] — пауза в секундах перед символом segments[i]; trailingPause — пауза после
 *   последнего символа (терминал её не выдерживает).
 */
export function parseTypingText(text) {
    const source = String(text || '');
    const segments = [];
    const pauses = [];
    let pending = 0;
    let style = { shake: false, color: null, size: null };
    let i = 0;

    while (i < source.length) {
        const rest = source.slice(i);
        let m;
        if ((m = rest.match(/^\[(\d+\.?\d*)s\]/))) {
            pending += parseFloat(m[1]);
        } else if ((m = rest.match(/^\[S:(\d+\.?\d*)\]/))) {
            const v = parseFloat(m[1]);
            if (v >= 0.8 && v <= 1.3) style = { ...style, size: v };
        } else if ((m = rest.match(/^\[Color:(.+?)\]/))) {
            style = { ...style, color: sanitizeColor(m[1]) };
        } else if (rest.startsWith('[Shake]')) {
            m = ['[Shake]'];
            style = { ...style, shake: true };
        } else if (rest.startsWith('[ShakeE]')) {
            m = ['[ShakeE]'];
            style = { ...style, shake: false };
        } else if (rest.startsWith('[ColorE]')) {
            m = ['[ColorE]'];
            style = { ...style, color: null };
        } else if (rest.startsWith('[SE]')) {
            m = ['[SE]'];
            style = { ...style, size: null };
        }

        if (m) {
            i += m[0].length;
            continue;
        }
        if (pending > 0) pauses[segments.length] = pending;
        pending = 0;
        segments.push({ char: source[i], style: { ...style } });
        i++;
    }

    return {
        segments,
        pauses,
        plain: segments.map(s => s.char).join(''),
        trailingPause: pending
    };
}

/**
 * Скорость печати под озвучку, мс на символ.
 * Модель — как в терминале (dialogue.js, typeText): символ i печатается, затем ждёт
 * «скорость + добавка за знак перед ним» (± случайность, в среднем ноль), паузы [Ns] стоят перед
 * символами. Последний символ должен появиться к концу речи, значит в расчёт входят задержки
 * символов 0…n−2: (n − 1) × скорость + добавки за знаки + паузы = длительность речи.
 * Пауза в самом конце не выдерживается, разметка и маркеры помех — не символы.
 *
 * @param {string} text — текст реплики уже с подставленными метками пилота
 * @param {number} durationSec — длительность речи в записи (без тишины по краям), с
 * @returns {{ speed?: number, chars: number, pauseSec: number, punctSec: number, typingSec: number, error?: string }}
 */
export function estimateTypingSpeed(text, durationSec) {
    const { segments, pauses } = parseTypingText(stripGlitchMarkers(text));
    const chars = segments.length;
    const pauseSec = pauses.reduce((sum, p) => sum + (p || 0), 0);
    let punctMs = 0;
    for (let i = 1; i <= chars - 2; i++) punctMs += punctuationDelay(segments[i - 1].char);
    const punctSec = punctMs / 1000;
    const typingSec = durationSec - pauseSec - punctSec;
    const base = { chars, pauseSec, punctSec, typingSec };
    if (!chars) return { ...base, error: 'В реплике нет печатаемого текста' };
    if (chars < 2) return { ...base, error: 'Реплика из одного символа: подгонять скорость не к чему' };
    if (!(durationSec > 0) || !isFinite(durationSec)) return { ...base, error: 'Не удалось определить длительность озвучки' };
    if (typingSec <= 0) {
        return { ...base, error: `Паузы [Ns] и знаки препинания (${(pauseSec + punctSec).toFixed(1)} с) не короче речи в записи (${durationSec.toFixed(1)} с)` };
    }
    // Ограничение — как у поля скорости (1–500).
    const speed = Math.min(500, Math.max(1, Math.round(typingSec * 1000 / (chars - 1))));
    return { ...base, speed };
}

// ---------- Скорость по фразам (ROADMAP, задача 9, шаг C) ----------
//
// Профиль скорости — список [с какого символа, мс/символ], по возрастанию позиции:
// [[0, 62], [13, 240], [15, 80]]. Скорость символа — у последней записи, чья позиция не больше
// его индекса (индексы — как в parseTypingText, без разметки). Пустой профиль — одна скорость.
// В базе хранится профиль по фразам ([внутри, после] на каждую фразу текста, см. expandProfile):
// он не зависит от длины подставленного имени пилота.

// Средняя задержка терминала при скорости 0 («стандартная»: 30–70 мс).
export const AUTO_SPEED_MEAN = 50;

export function speedAt(profile, index, fallback = 0) {
    let speed = fallback;
    if (Array.isArray(profile)) {
        for (const [from, value] of profile) {
            if (from > index) break;
            speed = value;
        }
    }
    return speed;
}

/**
 * Когда терминал напечатает каждый символ (средние значения, без случайностей), мс от начала печати.
 * profile — по символам; phraseProfile — по фразам (как в базе), раскладывается по этому тексту.
 * @returns {{ segments: Array, times: number[] }}
 */
export function typingTimeline(text, { speed = 0, profile = null, phraseProfile = null } = {}) {
    const { segments, pauses } = parseTypingText(stripGlitchMarkers(text));
    if (!profile && phraseProfile) profile = expandProfile(segments, pauses, phraseProfile);
    const times = [];
    let t = (pauses[0] || 0) * 1000;
    for (let i = 0; i < segments.length; i++) {
        if (i > 0) {
            const s = speedAt(profile, i - 1, speed) || AUTO_SPEED_MEAN;
            t += s + (i > 1 ? punctuationDelay(segments[i - 2].char) : 0) + (pauses[i] || 0) * 1000;
        }
        times.push(t);
    }
    return { segments, times };
}

// Знаки, после которых в речи бывает пауза; закрывающие кавычки и скобки идут вместе со знаком.
const BREAK_CHARS = new Set(['.', '!', '?', '…', ';', ':', ',', '—', '–']);
const CLOSING_CHARS = new Set(['»', '"', '”', ')', ']']);
const isSpace = c => /\s/.test(c);

// Серия знаков и закрывающих символов, кончающаяся на i, содержит знак препинания.
function endsWithBreak(segments, i) {
    for (let k = i; k >= 0; k--) {
        const c = segments[k].char;
        if (BREAK_CHARS.has(c)) return true;
        if (!CLOSING_CHARS.has(c)) return false;
    }
    return false;
}

/**
 * Фразы текста: границы — после знака препинания, за которым пробел, и перед паузой [Ns].
 * Пробелы между фразами не входят ни в одну: это промежуток, когда голос молчит.
 * @returns {Array<{from: number, to: number}>} — индексы первого и последнего символа фразы
 */
export function splitPhrases(segments, pauses = []) {
    const n = segments.length;
    const phrases = [];
    let from = 0;
    while (from < n - 1 && isSpace(segments[from].char)) from++;
    for (let i = from; i < n - 1; i++) {
        const c = segments[i].char;
        if (isSpace(c)) continue;
        const next = segments[i + 1].char;
        const afterBreak = isSpace(next) && endsWithBreak(segments, i);
        const beforePause = pauses[i + 1] > 0;
        if (!afterBreak && !beforePause) continue;
        let nextFrom = i + 1;
        while (nextFrom < n && isSpace(segments[nextFrom].char)) nextFrom++;
        if (nextFrom >= n) break;
        phrases.push({ from, to: i });
        from = nextFrom;
        i = nextFrom - 1;
    }
    if (from < n) phrases.push({ from, to: n - 1 });
    return phrases;
}

/**
 * Монотонное сопоставление: каждому элементу small — свой элемент large (индексы по возрастанию),
 * сумма квадратов разниц минимальна. Значения — доли от 0 до 1.
 * @returns {number[]} индексы в large
 */
export function alignMonotone(small, large) {
    const s = small.length, l = large.length;
    if (!s) return [];
    const cost = Array.from({ length: s }, () => new Array(l).fill(Infinity));
    const back = Array.from({ length: s }, () => new Array(l).fill(-1));
    for (let j = 0; j < l; j++) cost[0][j] = (small[0] - large[j]) ** 2;
    for (let i = 1; i < s; i++) {
        let best = Infinity, bestJ = -1;
        for (let j = i; j < l; j++) {
            if (cost[i - 1][j - 1] < best) { best = cost[i - 1][j - 1]; bestJ = j - 1; }
            cost[i][j] = best + (small[i] - large[j]) ** 2;
            back[i][j] = bestJ;
        }
    }
    let j = -1, best = Infinity;
    for (let k = s - 1; k < l; k++) if (cost[s - 1][k] < best) { best = cost[s - 1][k]; j = k; }
    const result = new Array(s);
    for (let i = s - 1; i >= 0; i--) { result[i] = j; j = back[i][j]; }
    return result;
}

const clampSpeed = v => Math.min(500, Math.max(1, Math.round(v)));

/**
 * Скорость по фразам под запись.
 * Фразы текста сопоставляются с участками речи по порядку и по доле длины: лишние паузы
 * в записи (вдох посреди фразы) или в тексте (запятая, на которой голос не замолчал) объединяются.
 * Затем по очереди для каждой фразы подбирается скорость, чтобы её первый символ появился,
 * когда голос начал фразу, а последний — когда закончил; промежуток между фразами (знак, пробелы,
 * паузы [Ns]) получает свою скорость, чтобы следующая фраза началась вместе с голосом.
 * Скорость считается от фактического времени, поэтому ограничение 1–500 не копит ошибку.
 *
 * @param {string} text — текст с подставленными метками пилота
 * @param {{start: number, end: number, segments: Array<{start: number, end: number}>}} voice — секунды от начала файла
 * @returns {{ speed?: number, phraseProfile?: Array<[number, number]>, profile: Array<[number, number]>,
 *             phrases: number, phrasesInText: number,
 *             speechParts: number, finishErrorMs: number, chars: number, pauseSec: number, punctSec: number,
 *             typingSec: number, error?: string }}
 *   speed — одна скорость на всю реплику (как в шаге B): её терминал берёт, если профиля нет.
 */
export function planTyping(text, voice) {
    const single = estimateTypingSpeed(text, voice.end - voice.start);
    const { segments, pauses } = parseTypingText(stripGlitchMarkers(text));
    const phrases = splitPhrases(segments, pauses);
    const parts = (voice.segments || []).map(s => ({ start: s.start - voice.start, end: s.end - voice.start }));
    const result = { ...single, profile: [], phrases: 1, phrasesInText: phrases.length, speechParts: parts.length, finishErrorMs: 0 };
    if (single.error || phrases.length < 2 || parts.length < 2) return result;

    const n = segments.length;
    const boundaries = phrases.slice(0, -1).map((p, b) => (p.to + 1 + phrases[b + 1].from) / 2 / n);
    const spoken = parts.reduce((sum, p) => sum + (p.end - p.start), 0);
    let acc = 0;
    const gaps = parts.slice(0, -1).map(p => (acc += p.end - p.start) / spoken);

    // Пары «граница в тексте — пауза в записи».
    const pairs = boundaries.length <= gaps.length
        ? alignMonotone(boundaries, gaps).map((g, b) => [b, g])
        : alignMonotone(gaps, boundaries).map((b, g) => [b, g]);
    // Группа — подряд идущие фразы текста (first…last), которые звучат одним участком речи.
    const groupsText = [];
    const groupsVoice = [];
    let pf = 0, vf = 0;
    for (const [b, g] of pairs) {
        groupsText.push({ first: pf, last: b, from: phrases[pf].from, to: phrases[b].to });
        groupsVoice.push({ start: parts[vf].start, end: parts[g].end });
        pf = b + 1;
        vf = g + 1;
    }
    groupsText.push({ first: pf, last: phrases.length - 1, from: phrases[pf].from, to: phrases[phrases.length - 1].to });
    groupsVoice.push({ start: parts[vf].start, end: parts[parts.length - 1].end });

    const punctOf = i => (i >= 1 ? punctuationDelay(segments[i - 1].char) : 0);
    const pauseOf = i => (pauses[i] || 0) * 1000;
    // Добавки за знаки у символов a…b−1 и паузы перед символами a+1…b.
    const fixedBetween = (a, b) => {
        let sum = 0;
        for (let i = a; i < b; i++) sum += punctOf(i) + pauseOf(i + 1);
        return sum;
    };

    const inside = [];   // скорость внутри группы
    const before = [];   // скорость промежутка перед группой
    let t = pauseOf(0);
    let prevTo = null;
    groupsText.forEach(({ from: a, to: b }, j) => {
        if (prevTo !== null) {
            const count = a - prevTo;
            const fixed = fixedBetween(prevTo, a);
            before[j] = clampSpeed((groupsVoice[j].start * 1000 - t - fixed) / count);
            t += count * before[j] + fixed;
        }
        inside[j] = single.speed;   // у группы из одного символа печатать внутри нечего
        if (b > a) {
            const count = b - a;
            const fixed = fixedBetween(a, b);
            inside[j] = clampSpeed((groupsVoice[j].end * 1000 - t - fixed) / count);
            t += count * inside[j] + fixed;
        }
        prevTo = b;
    });

    // Профиль по фразам текста: [внутри, после]. Внутри группы промежутки печатаются её скоростью.
    const phraseProfile = [];
    groupsText.forEach((group, j) => {
        for (let k = group.first; k <= group.last; k++) {
            const after = k < group.last ? inside[j] : (before[j + 1] ?? inside[j]);
            phraseProfile.push([inside[j], after]);
        }
    });
    return {
        ...result,
        phraseProfile,
        profile: expandProfile(segments, pauses, phraseProfile) || [],
        phrases: groupsText.length,
        finishErrorMs: Math.round(t - (voice.end - voice.start) * 1000)
    };
}

/**
 * Профиль по фразам → профиль по символам для конкретного текста.
 * Хранится профиль по фразам, а не по символам: метки пилота подставляются в терминале
 * (у пилота имя другой длины, чем у тестового в студии), и позиции символов сдвигаются,
 * а фразы — нет. Число фраз не совпало (текст поменяли без «Авто») — null, печать одной скоростью.
 *
 * @param {Array<[number, number]>} phraseProfile — для каждой фразы [мс/символ внутри, мс/символ после]
 * @returns {Array<[number, number]> | null} — [с символа, мс/символ]
 */
export function expandProfile(segments, pauses, phraseProfile) {
    if (!Array.isArray(phraseProfile) || !phraseProfile.length) return null;
    const phrases = splitPhrases(segments, pauses);
    if (phrases.length !== phraseProfile.length) return null;
    const profile = [];
    phrases.forEach((p, k) => {
        const [inside, after] = phraseProfile[k];
        if (p.to > p.from) profile.push([p.from, inside]);
        if (k < phrases.length - 1) profile.push([p.to, after]);
    });
    return profile.filter((entry, k) => k === 0 || entry[1] !== profile[k - 1][1]);
}
