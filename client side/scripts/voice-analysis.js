// Анализ файла озвучки: точная длительность, границы речи и паузы внутри неё (ROADMAP, задача 9,
// шаги B и C).
//
// Файл декодируется через Web Audio (decodeAudioData) — длина считается по сэмплам, а не по
// оценке из заголовка (у MP3 с переменным битрейтом loadedmetadata ошибается на проценты).
// Затем по громкости находятся участки речи: где голос начинается, где заканчивается и где
// внутри замолкает между фразами. Тишина по краям не растягивает печать (терминал ждёт начала
// голоса — voice_offset), а участки речи студия сопоставляет с фразами текста (typing-text.js).

export const SPEECH_DEFAULTS = Object.freeze({
    windowMs: 20,       // окно для громкости (RMS)
    relativeDb: 35,     // порог: на столько дБ тише самого громкого окна
    floorDb: -65,       // но не тише этого: ниже — шум записи, а не голос
    minGapMs: 150,      // тишина короче — провал внутри слова, а не пауза между фразами
    minRunMs: 60,       // участок речи короче (после склейки) — щелчок, а не голос
    padMs: 20           // запас перед началом речи: мягкая первая согласная тише порога
});

const dbOf = meanSquare => 10 * Math.log10(meanSquare + 1e-12);

/**
 * Участки речи по сэмплам.
 * @param {Float32Array[]} channels — каналы записи (громкость усредняется по ним)
 * @param {number} sampleRate
 * @param {object} [options] — см. SPEECH_DEFAULTS
 * @returns {{ duration: number, start: number, end: number, segments: Array<{start: number, end: number}>,
 *             peakDb: number, thresholdDb: number, silent: boolean }}
 *   Время — в секундах от начала файла. start / end — начало первого и конец последнего участка;
 *   silent — речи не нашлось (тогда один участок на всю длину).
 */
export function detectSpeech(channels, sampleRate, options = {}) {
    const o = { ...SPEECH_DEFAULTS, ...options };
    const length = channels.length ? channels[0].length : 0;
    const duration = sampleRate > 0 ? length / sampleRate : 0;
    const win = Math.max(1, Math.round(sampleRate * o.windowMs / 1000));
    const count = Math.ceil(length / win);
    const levels = new Float64Array(count);

    for (let w = 0; w < count; w++) {
        const from = w * win;
        const to = Math.min(length, from + win);
        let sum = 0;
        for (const data of channels) {
            for (let i = from; i < to; i++) sum += data[i] * data[i];
        }
        levels[w] = dbOf(sum / ((to - from) * channels.length || 1));
    }

    let peakDb = -Infinity;
    for (let w = 0; w < count; w++) if (levels[w] > peakDb) peakDb = levels[w];
    const thresholdDb = Math.max(peakDb - o.relativeDb, o.floorDb);
    const silentResult = { duration, start: 0, end: duration, segments: [{ start: 0, end: duration }], peakDb, thresholdDb, silent: true };
    if (!count || peakDb < o.floorDb) return silentResult;

    // Серии громких окон → склеить через короткие провалы → отбросить короткие (щелчки).
    const runs = [];
    for (let w = 0; w < count; w++) {
        if (levels[w] < thresholdDb) continue;
        const last = runs[runs.length - 1];
        if (last && last.to === w) last.to = w + 1;
        else runs.push({ from: w, to: w + 1 });
    }
    const gapWindows = Math.max(1, Math.round(o.minGapMs / o.windowMs));
    const merged = [];
    for (const r of runs) {
        const last = merged[merged.length - 1];
        if (last && r.from - last.to < gapWindows) last.to = r.to;
        else merged.push({ ...r });
    }
    const minWindows = Math.max(1, Math.round(o.minRunMs / o.windowMs));
    const speech = merged.filter(r => r.to - r.from >= minWindows);
    if (!speech.length) return silentResult;

    const pad = o.padMs / 1000;
    const segments = speech.map(r => ({
        start: Math.max(0, r.from * win / sampleRate - pad),
        end: Math.min(duration, r.to * win / sampleRate)
    }));
    return { duration, start: segments[0].start, end: segments[segments.length - 1].end, segments, peakDb, thresholdDb, silent: false };
}

let decoder = null;
function getDecoder() {
    if (decoder) return decoder;
    // Для декодирования хватает офлайн-контекста: он ничего не играет и не требует жеста.
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (Offline) decoder = new Offline(1, 1, 44100);
    else decoder = new (window.AudioContext || window.webkitAudioContext)();
    return decoder;
}

function decode(arrayBuffer) {
    const ctx = getDecoder();
    // Safari до 14.1 знает только вариант с колбэками.
    return new Promise((resolve, reject) => {
        const p = ctx.decodeAudioData(arrayBuffer, resolve, reject);
        if (p && typeof p.then === 'function') p.then(resolve, reject);
    });
}

/**
 * Загружает и разбирает файл озвучки.
 * @param {string} url
 * @returns {Promise<{ duration: number, start: number, end: number, speech: number, leadSilence: number,
 *                     tailSilence: number, segments: Array<{start: number, end: number}>, silent: boolean }>}
 */
export async function analyzeVoice(url, options) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Файл озвучки не загрузился (${response.status})`);
    const buffer = await decode(await response.arrayBuffer());
    const channels = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
    const r = detectSpeech(channels, buffer.sampleRate, options);
    return {
        duration: r.duration,
        start: r.start,
        end: r.end,
        speech: r.end - r.start,
        leadSilence: r.start,
        tailSilence: r.duration - r.end,
        segments: r.segments,
        silent: r.silent
    };
}
