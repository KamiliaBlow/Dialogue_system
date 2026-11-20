// «ЗАПИСЬ» на терминале: брифинги миссий.
//
// Баннер «ЗАПИСЬ» загорается, если игроку доступен хотя бы один брифинг. Пока есть непрослушанные,
// рядом мерцает метка с их числом. Клик открывает список записей, запись — 3D-плеер поверх
// терминала (briefing/player.html во фрейме). Фоновая музыка на это время встаёт на паузу.
// Плеер сообщает «прослушан» (дошёл до финального экрана) и «выйти» через postMessage.
import AppConfig from './config.js';

const API = AppConfig.API_URL;
const state = { list: [], unread: 0, open: false };
let banner = null, codec = null, panel = null, player = null, musicWasPlaying = false;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function load() {
    try {
        const r = await fetch(`${API}/briefings`, { credentials: 'include' });
        if (!r.ok) return;
        const data = await r.json();
        state.list = data.briefings || [];
        state.unread = data.unread || 0;
    } catch { /* сервер недоступен — баннер остаётся тусклым */ }
    renderBanner();
    if (panel && !panel.hidden) renderList();
}

function renderBanner() {
    banner = banner || document.getElementById('memory_banner');
    if (!banner) return;
    const on = state.list.length > 0;
    banner.classList.toggle('mem-on', on);
    banner.title = on ? 'Записи брифингов' : 'Записей нет';
    banner.setAttribute('role', on ? 'button' : '');
    banner.tabIndex = on ? 0 : -1;
    let mark = banner.querySelector('.mem-new');
    if (!mark) {
        mark = document.createElement('span');
        mark.className = 'mem-new';
        mark.innerHTML = '<i class="unread-mark"></i><b></b>';
        (banner.querySelector('h2') || banner).appendChild(mark);   // внутри надписи — берёт её цвет, когда баннер горит
    }
    mark.hidden = !state.unread;
    mark.querySelector('b').textContent = state.unread;
    mark.title = `Непрослушанных брифингов: ${state.unread}`;
}

function clickSound() {
    try { const a = new Audio('assets/sounds/click.mp3'); a.volume = .4; a.play().catch(() => {}); } catch { /* без звука */ }
}

// ---------- режим «Запись» ----------
// Пока открыт список записей или идёт брифинг, «ЗАПИСЬ» горит так же, как «СВЯЗЬ», а «СВЯЗЬ» гаснет.
// Баннеры меняются местами по id: каждая тема рисует #codec_banner активным, а #memory_banner
// тусклым (styles/themes.css), поэтому «ЗАПИСЬ» выглядит ровно как «СВЯЗЬ» в теме пилота.
// Других ссылок на эти id в коде терминала нет.
let recMode = false;
function setRecMode(on) {
    if (on === recMode || !banner || !codec) return;
    recMode = on;
    codec.id = on ? 'memory_banner' : 'codec_banner';
    banner.id = on ? 'codec_banner' : 'memory_banner';
    document.body.classList.toggle('rec-mode', on);
}

// ---------- список записей ----------
function openList() {
    if (!state.list.length) return;
    clickSound();
    setRecMode(true);
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'rec-panel';
        panel.innerHTML = `
            <div class="rec-box" role="dialog" aria-label="Записи брифингов">
                <div class="rec-head"><span>ЗАПИСИ · БРИФИНГИ</span><button type="button" class="rec-x" aria-label="Закрыть">✕</button></div>
                <div class="rec-list"></div>
                <div class="rec-foot">Новые записи отмечены. Запись считается прослушанной, когда брифинг дослушан до конца.</div>
            </div>`;
        document.body.appendChild(panel);
        panel.addEventListener('click', e => { if (e.target === panel || e.target.closest('.rec-x')) closeList(); });
    }
    panel.hidden = false;
    renderList();
    load();
}
// keepMode — список закрывается, потому что открывается запись: режим «Запись» остаётся до её закрытия.
function closeList(keepMode = false) {
    if (panel) panel.hidden = true;
    if (!keepMode && !player) setRecMode(false);
}

function renderList() {
    const box = panel.querySelector('.rec-list');
    box.innerHTML = state.list.map(b => `
        <button type="button" class="rec-item ${b.listened ? '' : 'is-new'}" data-id="${esc(b.id)}">
            <span class="rec-code">${esc(b.code || '—')}</span>
            <span class="rec-main"><b>${esc(b.title || 'Без названия')}</b><small>${esc(b.client || '')}</small></span>
            <span class="rec-state">${b.listened ? 'прослушана' : '<i class="unread-mark"></i>новая'}</span>
        </button>`).join('');
    box.querySelectorAll('.rec-item').forEach(el => el.addEventListener('click', () => play(Number(el.dataset.id))));
}

// ---------- плеер поверх терминала ----------
function musicElement() {
    try { if (window.parent !== window && window.parent.MusicHost?.audio) return window.parent.MusicHost.audio; } catch { /* чужой домен */ }
    return document.getElementById('background-music');
}

function play(id) {
    clickSound();
    closeList(true);
    const music = musicElement();
    musicWasPlaying = !!(music && !music.paused);
    if (music) music.pause();
    player = document.createElement('div');
    player.id = 'rec-player';
    // Тема пилота — брифинг оформляется под ту же корпорацию, что и терминал (briefing/themes.js)
    const theme = ([...document.body.classList].find(c => c.startsWith('theme-')) || '').slice(6);
    player.innerHTML = `<iframe title="Брифинг" allow="autoplay; fullscreen" src="briefing/player.html?id=${encodeURIComponent(id)}${theme ? `&theme=${encodeURIComponent(theme)}` : ''}"></iframe>`;
    document.body.appendChild(player);
    state.open = true;
    player.querySelector('iframe').focus();
}

function closePlayer() {
    if (!player) return;
    player.remove();
    player = null;
    state.open = false;
    setRecMode(false);
    const music = musicElement();
    if (music && musicWasPlaying) music.play().catch(() => {});
    load();
}

window.addEventListener('message', e => {
    if (!player || e.source !== player.querySelector('iframe')?.contentWindow || !e.data) return;
    if (e.data.type === 'briefing:listened') {
        const b = state.list.find(x => x.id === e.data.id);
        if (b && !b.listened) { b.listened = true; state.unread = Math.max(0, state.unread - 1); renderBanner(); }
    }
    if (e.data.type === 'briefing:exit') closePlayer();
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && panel && !panel.hidden) closeList();
});

function init() {
    banner = document.getElementById('memory_banner');
    codec = document.getElementById('codec_banner');
    if (!banner) return;
    banner.addEventListener('click', () => { if (!recMode) openList(); });
    banner.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openList(); } });
    load();
    // Пока терминал открыт, список обновляется: мастер мог опубликовать новую запись.
    setInterval(() => { if (!state.open && document.visibilityState === 'visible') load(); }, 120000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
