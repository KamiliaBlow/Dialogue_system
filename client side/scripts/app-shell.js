// Оболочка сайта (app.html): держит фоновую музыку и показывает страницы во фрейме.
//
// Музыкой по-прежнему управляет scripts/music-player.js на каждой странице — плейлист, кнопка,
// громкость, сохранение позиции. Только сам звук (<audio>) живёт здесь, в window.MusicHost:
// страница во фрейме сменяется, а элемент со звуком остаётся, поэтому переход не прерывает музыку.
(function () {
    'use strict';

    // Что можно открыть в оболочке: только свои страницы (не чужие адреса и не javascript:).
    const PAGES = ['index.html', 'login.html', 'pilot_profile.html', 'admin.html', 'studio.html', 'catalog.html', 'editor.html'];
    const DEFAULT_PAGE = 'index.html';

    const frame = document.getElementById('app-frame');
    const audio = document.getElementById('shell-music');

    window.MusicHost = { audio };

    function sanitize(target) {
        const match = /^([a-z_]+\.html)([?#].*)?$/.exec(target || '');
        if (!match || !PAGES.includes(match[1])) return DEFAULT_PAGE;
        return match[1] + (match[2] || '');
    }

    function innerAddress() {
        try {
            const loc = frame.contentWindow.location;
            if (loc.href === 'about:blank') return null;
            return (loc.pathname.split('/').pop() || DEFAULT_PAGE) + loc.search + loc.hash;
        } catch {
            return null;
        }
    }

    // Адрес оболочки повторяет страницу во фрейме: обновление страницы открывает её же.
    function syncAddress() {
        const inner = innerAddress();
        if (!inner || location.hash.slice(1) === inner) return;
        history.replaceState(null, '', `${location.pathname}${location.search}#${inner}`);
    }

    function syncTitle() {
        try {
            const title = frame.contentDocument.title;
            if (title) document.title = title;
        } catch { /* страница ещё грузится */ }
    }

    // Страховка: если веб-сервер запрещает показывать страницы во фрейме (X-Frame-Options,
    // frame-ancestors), фрейм остаётся пустым — тогда открываем страницу как обычно, без оболочки
    // (страница не будет возвращать сюда до закрытия вкладки), чтобы сайт работал.
    function leaveShell(target) {
        try { sessionStorage.setItem('noShell', '1'); } catch { /* хранилище недоступно */ }
        location.replace(target);
    }

    frame.addEventListener('load', () => {
        let win;
        let doc;
        try {
            win = frame.contentWindow;
            doc = frame.contentDocument;
            if (!doc || win.location.protocol === 'chrome-error:') throw new Error('blocked');
        } catch {
            leaveShell(sanitize(location.hash.slice(1)));
            return;
        }
        syncAddress();
        syncTitle();
        // Страница меняет свой адрес (вкладки панели и студии) — оболочка следом.
        win.addEventListener('hashchange', syncAddress);
        win.addEventListener('popstate', syncAddress);
        ['pushState', 'replaceState'].forEach(name => {
            const original = win.history[name];
            win.history[name] = function (...args) {
                const result = original.apply(this, args);
                syncAddress();
                return result;
            };
        });
        // Заголовок вкладки — как у страницы (админка дописывает его после загрузки).
        const titleEl = doc.querySelector('title');
        if (titleEl) new MutationObserver(syncTitle).observe(titleEl, { childList: true, characterData: true, subtree: true });

        // Экран входа без музыки: после выхода из аккаунта трек не играет дальше.
        if (/^login\.html/.test(innerAddress() || '')) audio.pause();
    });

    // Адрес оболочки поменяли вручную — открываем эту страницу.
    window.addEventListener('hashchange', () => {
        const target = sanitize(location.hash.slice(1));
        if (target !== innerAddress()) frame.contentWindow.location.replace(target);
    });

    let start = location.hash.slice(1);
    try { start = decodeURI(start); } catch { /* битая кодировка — откроется главная */ }
    frame.src = sanitize(start);
})();
