/*
  Озвучка шагов брифинга: границы речи, паузы и скорость печати по фразам.

  Логика перенесена из студии базового проекта без изменений в правилах:
    client side/scripts/voice-analysis.js  — detectSpeech (громкость по окнам, склейка, отсев щелчков)
    client side/scripts/typing-text.js     — паузы за знаками, разбиение на фразы, planTyping, expandProfile
  Здесь — обычный скрипт (не модуль), чтобы демо открывалось с диска. Из разметки текста
  поддерживаются только паузы [Ns]: эффектов терминала (цвет, тряска) в брифинге нет.
  Если правила в студии поменяются — синхронизируйте этот файл.
*/
(function () {
'use strict';

const SPEECH_DEFAULTS = Object.freeze({ windowMs:20, relativeDb:35, floorDb:-65, minGapMs:150, minRunMs:60, padMs:20 });
const dbOf = ms => 10 * Math.log10(ms + 1e-12);

function detectSpeech(channels, sampleRate, options = {}) {
  const o = { ...SPEECH_DEFAULTS, ...options };
  const length = channels.length ? channels[0].length : 0;
  const duration = sampleRate > 0 ? length / sampleRate : 0;
  const win = Math.max(1, Math.round(sampleRate * o.windowMs / 1000));
  const count = Math.ceil(length / win);
  const levels = new Float64Array(count);
  for (let w = 0; w < count; w++) {
    const from = w * win, to = Math.min(length, from + win); let sum = 0;
    for (const data of channels) for (let i = from; i < to; i++) sum += data[i] * data[i];
    levels[w] = dbOf(sum / ((to - from) * channels.length || 1));
  }
  let peakDb = -Infinity; for (let w = 0; w < count; w++) if (levels[w] > peakDb) peakDb = levels[w];
  const thresholdDb = Math.max(peakDb - o.relativeDb, o.floorDb);
  const silentResult = { duration, start:0, end:duration, segments:[{ start:0, end:duration }], peakDb, thresholdDb, silent:true };
  if (!count || peakDb < o.floorDb) return silentResult;
  const runs = [];
  for (let w = 0; w < count; w++) { if (levels[w] < thresholdDb) continue; const last = runs[runs.length - 1]; if (last && last.to === w) last.to = w + 1; else runs.push({ from:w, to:w + 1 }); }
  const gapWindows = Math.max(1, Math.round(o.minGapMs / o.windowMs)), merged = [];
  for (const r of runs) { const last = merged[merged.length - 1]; if (last && r.from - last.to < gapWindows) last.to = r.to; else merged.push({ ...r }); }
  const minWindows = Math.max(1, Math.round(o.minRunMs / o.windowMs));
  const speech = merged.filter(r => r.to - r.from >= minWindows);
  if (!speech.length) return silentResult;
  const pad = o.padMs / 1000;
  const segments = speech.map(r => ({ start:Math.max(0, r.from * win / sampleRate - pad), end:Math.min(duration, r.to * win / sampleRate) }));
  return { duration, start:segments[0].start, end:segments[segments.length - 1].end, segments, peakDb, thresholdDb, silent:false };
}

async function decodeBlob(blob) {
  const ab = await blob.arrayBuffer();
  const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = Off ? new Off(1, 1, 44100) : new (window.AudioContext || window.webkitAudioContext)();
  return new Promise((res, rej) => { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.then) p.then(res, rej); });
}
/* Разбор файла: длительность, участки речи и пики для рисования волны. */
async function analyzeBlob(blob) {
  const buf = await decodeBlob(blob), channels = [];
  for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
  const r = detectSpeech(channels, buf.sampleRate);
  const N = 240, data = channels[0], step = Math.max(1, Math.floor(data.length / N)), peaks = []; let mx = 1e-6;
  for (let i = 0; i < N; i++) { let p = 0; for (let k = i * step, e = Math.min(data.length, k + step); k < e; k += 4) { const v = Math.abs(data[k]); if (v > p) p = v; } peaks.push(p); if (p > mx) mx = p; }
  return { duration:r.duration, start:r.start, end:r.end, segments:r.segments, silent:r.silent, peaks:peaks.map(p => Math.round(p / mx * 100) / 100) };
}

/* ---------- печать (правила студии) ---------- */
const PUNCT = Object.freeze({ '.':350, '!':300, '?':300, ':':250, ';':250, ',':150 });
const punctuationDelay = c => PUNCT[c] || 0;
const AUTO_SPEED_MEAN = 50;
const DEFAULT_SPEED = 24;          // брифинг по умолчанию печатает быстрее терминала

function parse(text) {
  const src = String(text || ''), segments = [], pauses = []; let pending = 0, i = 0;
  while (i < src.length) {
    const m = src.slice(i).match(/^\[(\d+\.?\d*)s\]/);
    if (m) { pending += parseFloat(m[1]); i += m[0].length; continue; }
    segments.push({ char:src[i] }); pauses.push(pending); pending = 0; i++;
  }
  return { segments, pauses, plain:segments.map(s => s.char).join(''), trailingPause:pending };
}
function estimateTypingSpeed(text, durationSec) {
  const { segments, pauses } = parse(text), chars = segments.length;
  const pauseSec = pauses.reduce((s, p) => s + (p || 0), 0);
  let punctMs = 0; for (let i = 1; i <= chars - 2; i++) punctMs += punctuationDelay(segments[i - 1].char);
  const punctSec = punctMs / 1000, typingSec = durationSec - pauseSec - punctSec, base = { chars, pauseSec, punctSec, typingSec };
  if (!chars) return { ...base, error:'В реплике нет печатаемого текста' };
  if (chars < 2) return { ...base, error:'Реплика из одного символа' };
  if (!(durationSec > 0) || !isFinite(durationSec)) return { ...base, error:'Не удалось определить длительность озвучки' };
  if (typingSec <= 0) return { ...base, error:`Паузы и знаки препинания (${(pauseSec + punctSec).toFixed(1)} с) не короче речи (${durationSec.toFixed(1)} с)` };
  return { ...base, speed:Math.min(500, Math.max(1, Math.round(typingSec * 1000 / (chars - 1)))) };
}
function speedAt(profile, index, fallback = 0) { let s = fallback; if (Array.isArray(profile)) for (const [from, v] of profile) { if (from > index) break; s = v; } return s; }
const BREAK = new Set(['.', '!', '?', '…', ';', ':', ',', '—', '–']), CLOSING = new Set(['»', '"', '”', ')', ']']), isSpace = c => /\s/.test(c);
function endsWithBreak(seg, i) { for (let k = i; k >= 0; k--) { const c = seg[k].char; if (BREAK.has(c)) return true; if (!CLOSING.has(c)) return false; } return false; }
function splitPhrases(segments, pauses = []) {
  const n = segments.length, phrases = []; let from = 0;
  while (from < n - 1 && isSpace(segments[from].char)) from++;
  for (let i = from; i < n - 1; i++) {
    if (isSpace(segments[i].char)) continue;
    const afterBreak = isSpace(segments[i + 1].char) && endsWithBreak(segments, i), beforePause = pauses[i + 1] > 0;
    if (!afterBreak && !beforePause) continue;
    let nf = i + 1; while (nf < n && isSpace(segments[nf].char)) nf++;
    if (nf >= n) break;
    phrases.push({ from, to:i }); from = nf; i = nf - 1;
  }
  if (from < n) phrases.push({ from, to:n - 1 });
  return phrases;
}
function alignMonotone(small, large) {
  const s = small.length, l = large.length; if (!s) return [];
  const cost = Array.from({ length:s }, () => new Array(l).fill(Infinity)), back = Array.from({ length:s }, () => new Array(l).fill(-1));
  for (let j = 0; j < l; j++) cost[0][j] = (small[0] - large[j]) ** 2;
  for (let i = 1; i < s; i++) { let best = Infinity, bj = -1;
    for (let j = i; j < l; j++) { if (cost[i - 1][j - 1] < best) { best = cost[i - 1][j - 1]; bj = j - 1; } cost[i][j] = best + (small[i] - large[j]) ** 2; back[i][j] = bj; } }
  let j = -1, best = Infinity; for (let k = s - 1; k < l; k++) if (cost[s - 1][k] < best) { best = cost[s - 1][k]; j = k; }
  const res = new Array(s); for (let i = s - 1; i >= 0; i--) { res[i] = j; j = back[i][j]; } return res;
}
const clampSpeed = v => Math.min(500, Math.max(1, Math.round(v)));
function expandProfile(segments, pauses, phraseProfile) {
  if (!Array.isArray(phraseProfile) || !phraseProfile.length) return null;
  const phrases = splitPhrases(segments, pauses); if (phrases.length !== phraseProfile.length) return null;
  const profile = [];
  phrases.forEach((p, k) => { const [inside, after] = phraseProfile[k]; if (p.to > p.from) profile.push([p.from, inside]); if (k < phrases.length - 1) profile.push([p.to, after]); });
  return profile.filter((e, k) => k === 0 || e[1] !== profile[k - 1][1]);
}
/* Скорость по фразам под запись (как кнопка «Авто» в студии). voice: {start, end, segments} в секундах. */
function planTyping(text, voice) {
  const single = estimateTypingSpeed(text, voice.end - voice.start);
  const { segments, pauses } = parse(text), phrases = splitPhrases(segments, pauses);
  const parts = (voice.segments || []).map(s => ({ start:s.start - voice.start, end:s.end - voice.start }));
  const result = { ...single, profile:[], phrases:1, phrasesInText:phrases.length, speechParts:parts.length, finishErrorMs:0 };
  if (single.error || phrases.length < 2 || parts.length < 2) return result;
  const n = segments.length;
  const boundaries = phrases.slice(0, -1).map((p, b) => (p.to + 1 + phrases[b + 1].from) / 2 / n);
  const spoken = parts.reduce((s, p) => s + (p.end - p.start), 0); let acc = 0;
  const gaps = parts.slice(0, -1).map(p => (acc += p.end - p.start) / spoken);
  const pairs = boundaries.length <= gaps.length ? alignMonotone(boundaries, gaps).map((g, b) => [b, g]) : alignMonotone(gaps, boundaries).map((b, g) => [b, g]);
  const gT = [], gV = []; let pf = 0, vf = 0;
  for (const [b, g] of pairs) { gT.push({ first:pf, last:b, from:phrases[pf].from, to:phrases[b].to }); gV.push({ start:parts[vf].start, end:parts[g].end }); pf = b + 1; vf = g + 1; }
  gT.push({ first:pf, last:phrases.length - 1, from:phrases[pf].from, to:phrases[phrases.length - 1].to }); gV.push({ start:parts[vf].start, end:parts[parts.length - 1].end });
  const punctOf = i => (i >= 1 ? punctuationDelay(segments[i - 1].char) : 0), pauseOf = i => (pauses[i] || 0) * 1000;
  const fixedBetween = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += punctOf(i) + pauseOf(i + 1); return s; };
  const inside = [], before = []; let t = pauseOf(0), prevTo = null;
  gT.forEach(({ from:a, to:b }, j) => {
    if (prevTo !== null) { const c = a - prevTo, f = fixedBetween(prevTo, a); before[j] = clampSpeed((gV[j].start * 1000 - t - f) / c); t += c * before[j] + f; }
    inside[j] = single.speed;
    if (b > a) { const c = b - a, f = fixedBetween(a, b); inside[j] = clampSpeed((gV[j].end * 1000 - t - f) / c); t += c * inside[j] + f; }
    prevTo = b;
  });
  const phraseProfile = [];
  gT.forEach((g, j) => { for (let k = g.first; k <= g.last; k++) phraseProfile.push([inside[j], k < g.last ? inside[j] : (before[j + 1] ?? inside[j])]); });
  return { ...result, phraseProfile, profile:expandProfile(segments, pauses, phraseProfile) || [], phrases:gT.length, finishErrorMs:Math.round(t - (voice.end - voice.start) * 1000) };
}
/* Время появления каждого символа, мс от начала печати. */
function typingTimeline(text, { speed = 0, phraseProfile = null } = {}) {
  const { segments, pauses } = parse(text), profile = phraseProfile ? expandProfile(segments, pauses, phraseProfile) : null, times = [];
  let t = (pauses[0] || 0) * 1000;
  for (let i = 0; i < segments.length; i++) {
    if (i > 0) t += (speedAt(profile, i - 1, speed) || AUTO_SPEED_MEAN) + (i > 1 ? punctuationDelay(segments[i - 2].char) : 0) + (pauses[i] || 0) * 1000;
    times.push(t);
  }
  return { plain:segments.map(s => s.char).join(''), times, profileOk:!phraseProfile || !!profile };
}
/* Профиль по фразам ещё подходит к тексту (текст не меняли после «Авто»). */
function profileFits(text, phraseProfile) { if (!phraseProfile) return true; const { segments, pauses } = parse(text); return !!expandProfile(segments, pauses, phraseProfile); }

window.BriefingVoice = { detectSpeech, analyzeBlob, parse, planTyping, typingTimeline, profileFits, splitPhrases, DEFAULT_SPEED };
})();
