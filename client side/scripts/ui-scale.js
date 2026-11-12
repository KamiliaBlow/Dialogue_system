/* Масштаб интерфейса терминала и досье.
 *
 * Итоговый масштаб = авто × пользовательский множитель, затем защита от переполнения.
 *  - Авто: min(ширина / 1920, высота / 1080), но не меньше 1 и не больше 2.
 *    Экраны меньше 1080p уже обслуживает адаптивная вёрстка (медиазапросы), поэтому
 *    авто только увеличивает интерфейс на 2K / 4K, а не ужимает его на ноутбуке.
 *  - Пользовательский множитель: 75–150 %, шаг 5 %. Хранится в localStorage, то есть
 *    на устройство: на 2K-мониторе и телефоне нужны разные значения.
 *  - Защита: выбранный блок (на терминале — #mCodec) целиком помещается в окно
 *    и не заезжает под кнопки у краёв экрана.
 *
 * Значение пишется в CSS-переменную --ui-scale на <html>; элементы масштабируются
 * через `zoom: var(--ui-scale)` (styles/themes.css, pilot_profile.html). В отличие
 * от transform, zoom пересчитывает вёрстку: клики, прокрутка и переносы остаются верными.
 *
 * Скрипт подключается в <head> синхронно, чтобы масштаб (в том числе заставки
 * загрузки) был известен до первой отрисовки.
 */
(function (root) {
    'use strict';

    const STORAGE_KEY = 'uiScaleUser';
    const USER_MIN = 0.75;
    const USER_MAX = 1.5;
    const USER_STEP = 0.05;
    const BASE_WIDTH = 1920;
    const BASE_HEIGHT = 1080;
    const AUTO_MIN = 1;
    const AUTO_MAX = 2;
    const NARROW_WIDTH = 768;      // телефон: ниже этого масштаб не мельчит текст
    const NARROW_FLOOR = 0.9;
    const ABSOLUTE_FLOOR = 0.6;
    const FIT_MARGIN = 8;          // зазор до края окна и до кнопок, px
    const FIT_FLOOR = 0.3;         // ниже защита не опускает: лучше лёгкое перекрытие, чем нечитаемо

    const docEl = root.document.documentElement;
    let fitConfig = null;
    let userInMemory = null;       // последний выбор: действует, даже если localStorage недоступен
    let current = { auto: 1, user: 1, desired: 1, scale: 1, fitted: false };
    const listeners = new Set();

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function roundStep(value) {
        // Делим на целое число шагов: 24 / 20 = 1.2 ровно, без хвоста 1.2000000000000002.
        const steps = Math.round(1 / USER_STEP);
        return Math.round(value * steps) / steps;
    }

    function getUser() {
        if (userInMemory !== null) return userInMemory;
        try {
            const raw = parseFloat(root.localStorage.getItem(STORAGE_KEY));
            if (Number.isFinite(raw)) return clamp(roundStep(raw), USER_MIN, USER_MAX);
        } catch (e) { /* хранилище недоступно */ }
        return 1;
    }

    function getAuto() {
        const ratio = Math.min(root.innerWidth / BASE_WIDTH, root.innerHeight / BASE_HEIGHT);
        return clamp(ratio || 1, AUTO_MIN, AUTO_MAX);
    }

    function write(scale) {
        docEl.style.setProperty('--ui-scale', String(Math.round(scale * 1000) / 1000));
    }

    function resolveElements(list) {
        return (list || [])
            .map(item => typeof item === 'string' ? root.document.querySelector(item) : item)
            .filter(Boolean);
    }

    function visibleRect(el) {
        if (!el || !el.isConnected) return null;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? rect : null;
    }

    // Помещается ли блок при текущем масштабе: целиком в окне (с зазором) и не под кнопками.
    function fits() {
        if (!fitConfig) return true;
        const rect = visibleRect(resolveElements([fitConfig.target])[0]);
        if (!rect) return true;
        const m = FIT_MARGIN;
        if (rect.top < m || rect.left < m || rect.bottom > root.innerHeight - m || rect.right > root.innerWidth - m) return false;
        return !resolveElements(fitConfig.avoid).some(el => {
            const a = visibleRect(el);
            return a && a.left < rect.right + m && a.right > rect.left - m && a.top < rect.bottom + m && a.bottom > rect.top - m;
        });
    }

    function notify() {
        listeners.forEach(fn => { try { fn(Object.assign({}, current)); } catch (e) { /* слушатель упал */ } });
    }

    function apply() {
        const auto = getAuto();
        const user = getUser();
        const desired = auto * user;
        const floor = root.innerWidth < NARROW_WIDTH ? NARROW_FLOOR : ABSOLUTE_FLOOR;
        let scale = Math.max(desired, floor);
        write(scale);

        // Не помещается — ищем наибольший подходящий масштаб делением пополам.
        // Простая пропорция тут не годится: при уменьшении пульт может перестать
        // доставать до кнопок у края, и запас под них больше не нужен.
        let fitted = false;
        if (fitConfig && !fits()) {
            fitted = true;
            let lo = FIT_FLOOR;
            let hi = scale;
            for (let i = 0; i < 9; i++) {
                const mid = (lo + hi) / 2;
                write(mid);
                if (fits()) lo = mid; else hi = mid;
            }
            scale = lo;
            write(scale);
        }

        current = { auto, user, desired, scale, fitted };
        notify();
        return current;
    }

    let frame = 0;
    function schedule() {
        if (frame) return;
        frame = root.requestAnimationFrame(() => { frame = 0; apply(); });
    }

    function setUser(value) {
        const user = clamp(roundStep(Number(value) || 1), USER_MIN, USER_MAX);
        try {
            if (Math.abs(user - 1) < 0.001) root.localStorage.removeItem(STORAGE_KEY);
            else root.localStorage.setItem(STORAGE_KEY, String(user));
        } catch (e) { /* хранилище недоступно — масштаб действует до перезагрузки */ }
        userInMemory = user;
        return apply();
    }

    function reset() {
        return setUser(1);
    }

    // fit: { target: '#mCodec', avoid: ['#header-buttons', ...] } — блок, который должен поместиться.
    function init(options) {
        fitConfig = options && options.fit ? options.fit : null;
        apply();
    }

    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function percent(value) {
        return `${Math.round(value * 100)}%`;
    }

    // Ползунок масштаба: один и тот же на терминале (окно «Настройки») и в досье.
    // Оформление — в CSS страницы по классам .ui-scale-*.
    function mountControl(container) {
        if (!container) return null;
        const doc = root.document;
        const wrap = doc.createElement('div');
        wrap.className = 'ui-scale-control';
        wrap.innerHTML = `
            <label class="ui-scale-label">Масштаб интерфейса</label>
            <div class="ui-scale-row">
                <input type="range" class="ui-scale-range" min="${USER_MIN * 100}" max="${USER_MAX * 100}" step="${USER_STEP * 100}">
                <output class="ui-scale-value"></output>
                <button type="button" class="ui-scale-reset" title="Сбросить множитель: только авто по разрешению">Авто</button>
            </div>
            <small class="ui-scale-note" aria-live="polite"></small>`;
        const id = `ui-scale-range-${Math.random().toString(36).slice(2, 8)}`;
        const range = wrap.querySelector('.ui-scale-range');
        const value = wrap.querySelector('.ui-scale-value');
        const note = wrap.querySelector('.ui-scale-note');
        const resetBtn = wrap.querySelector('.ui-scale-reset');
        range.id = id;
        wrap.querySelector('.ui-scale-label').htmlFor = id;
        value.htmlFor = id;

        function render(state) {
            range.value = String(Math.round(state.user * 100));
            range.setAttribute('aria-valuetext', percent(state.user));
            value.textContent = percent(state.user);
            resetBtn.disabled = Math.abs(state.user - 1) < 0.001;
            let text = `Экран ×${(Math.round(state.auto * 100) / 100).toFixed(2)} · итог ${percent(state.scale)}`;
            if (state.fitted) text += ' — уменьшено, чтобы всё поместилось в окно';
            note.textContent = text;
        }

        range.addEventListener('input', () => setUser(Number(range.value) / 100));
        resetBtn.addEventListener('click', () => reset());
        const off = onChange(render);
        render(current);
        container.appendChild(wrap);

        // Окно закрыли (узел удалён) — отписываемся.
        if (root.MutationObserver) {
            const watcher = new root.MutationObserver(() => {
                if (!wrap.isConnected) { off(); watcher.disconnect(); }
            });
            watcher.observe(doc.body, { childList: true, subtree: true });
        }
        return wrap;
    }

    const api = {
        USER_MIN,
        USER_MAX,
        USER_STEP,
        init,
        apply,
        refresh: schedule,
        setUser,
        reset,
        getUser,
        getAuto,
        get state() { return Object.assign({}, current); },
        onChange,
        mountControl
    };

    // Ранний расчёт до отрисовки: без защиты от переполнения (DOM ещё не построен).
    write(Math.max(getAuto() * getUser(), root.innerWidth < NARROW_WIDTH ? NARROW_FLOOR : ABSOLUTE_FLOOR));

    root.addEventListener('resize', schedule);
    root.addEventListener('orientationchange', schedule);
    // Другая вкладка поменяла масштаб — применяем и здесь.
    root.addEventListener('storage', event => { if (event.key === STORAGE_KEY) { userInMemory = null; schedule(); } });
    if (root.document.fonts && root.document.fonts.ready) root.document.fonts.ready.then(schedule).catch(() => {});

    root.UiScale = api;
})(window);
