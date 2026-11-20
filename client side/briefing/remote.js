// Связь модуля брифинга с сервером системы: адреса API и файлов — из scripts/config.js,
// как у терминала и студии. Запросы идут с сессионной cookie.
import AppConfig from '../scripts/config.js';

export const API_URL = AppConfig.API_URL;
export const ASSETS_URL = AppConfig.ASSETS_URL;

// То же правило, что assetUrl в scripts/studio/studio-store.js: путь /assets/… — к серверу ассетов.
export function assetUrl(path) {
    if (!path) return '';
    if (/^(https?:|data:|blob:)/.test(path)) return path;
    if (!ASSETS_URL || /DOMENHERE|REPLACEME/.test(ASSETS_URL)) return path;
    if (path.startsWith('/assets/')) return ASSETS_URL.replace(/\/assets$/, '') + path;
    return path;
}

export async function api(path, opt = {}) {
    const headers = Object.assign({}, opt.headers);
    let body = opt.body;
    if (body && !(body instanceof FormData) && typeof body !== 'string') { body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    let r;
    try { r = await fetch(API_URL + path, { credentials:'include', ...opt, headers, body }); }
    catch (e) { const err = new Error('Нет связи с сервером'); err.status = 0; throw err; }
    let data = null; try { data = await r.json(); } catch { /* пустой ответ */ }
    if (!r.ok) { const err = new Error((data && data.message) || `Ошибка ${r.status}`); err.status = r.status; err.data = data; throw err; }
    return data;
}

// Загрузка файла звука брифинга: kind — voice | sfx | music. Возвращает путь /assets/sounds/briefing/…
export async function uploadAudio(file, kind) {
    const fd = new FormData(); fd.append('file', file, file.name || 'audio');
    const r = await api(`/editor/briefings/upload-audio?kind=${encodeURIComponent(kind)}`, { method:'POST', body:fd });
    return r.path;
}
