// Великие Дома КТБ: ливреи, знаки и положение персонажа в Баронствах.
// Канон (Lancer: Field Guide to the KTB / lancer.wiki.gg): список Великих Домов.
// Цвета ливрей и рисунки знаков — интерпретация проекта, в источниках не описаны.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KtbHouses = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    // Пути знаков в системе координат 40×40, рисуются линией currentColor.
    const SIGILS = {
        order: '<rect x="11" y="11" width="18" height="18" transform="rotate(45 20 20)"/><rect x="16" y="16" width="8" height="8"/>',
        glass: '<path d="M20 4 34 16 20 36 6 16Z M6 16H34 M14 16 20 4 26 16 20 36Z"/>',
        smoke: '<path d="M10 34c-5-5 5-9 0-14s5-9 0-14M20 34c-5-5 5-9 0-14s5-9 0-14M30 34c-5-5 5-9 0-14s5-9 0-14"/>',
        stone: '<path d="M5 33H35M8 33V25H32V33M12 25V17H28V25M16 17V9H24V17"/>',
        sand: '<path d="M4 30c8-9 16-9 16 0 0-9 8-9 16 0M4 22c8-9 16-9 16 0 0-9 8-9 16 0"/><circle cx="29" cy="9" r="3"/>',
        water: '<circle cx="20" cy="20" r="15"/><path d="M8 19c3-4 5-4 8 0s5 4 8 0 5-4 8 0M10 26c3-3 5-3 7 0s4 3 7 0 4-3 6 0"/>',
        dust: '<g fill="currentColor" stroke="none"><circle cx="20" cy="8" r="2.4"/><circle cx="11" cy="17" r="2"/><circle cx="29" cy="17" r="2"/><circle cx="20" cy="20" r="3"/><circle cx="13" cy="29" r="1.6"/><circle cx="27" cy="29" r="1.6"/><circle cx="20" cy="33" r="1.2"/></g>',
        moments: '<path d="M11 5H29M11 35H29M13 5 27 35M27 5 13 35M17 31h6"/>',
        remembrance: '<path d="M16 35V18H24V35ZM11 35H29M20 18V15"/><path d="M20 4c4 5 4 8 0 11-4-3-4-6 0-11Z"/>',
        promise: '<path d="M20 3V37M3 20H37M8 8 32 32M32 8 8 32"/><circle cx="20" cy="20" r="6"/>',
        // Дополнительные знаки для собственных Домов.
        crown: '<path d="M6 30 9 12 16 21 20 8 24 21 31 12 34 30Z M6 34H34"/>',
        tower: '<path d="M12 35V14H28V35M10 14V8H14V11H18V8H22V11H26V8H30V14M18 35V28H22V35"/>',
        blade: '<path d="M20 3 24 9V26H16V9Z M11 26H29M20 26V33M17 36H23"/>',
        wing: '<path d="M5 30C13 26 18 17 20 6 22 17 27 26 35 30M10 24C14 22 17 18 19 13M30 24C26 22 23 18 21 13"/>',
        star: '<path d="M20 4 23.5 15H35L25.5 22 29 33 20 26 11 33 14.5 22 5 15H16.5Z"/>',
        key: '<circle cx="13" cy="20" r="7"/><path d="M20 20H36M30 20V26M34 20V24"/>'
    };

    const HOUSES = [
        { id: 'order', word: 'Порядка', color: '#c9b27c', sigil: 'order' },
        { id: 'glass', word: 'Стекла', color: '#86bcbc', sigil: 'glass' },
        { id: 'smoke', word: 'Дыма', color: '#9a948d', sigil: 'smoke' },
        { id: 'stone', word: 'Камня', color: '#a38f78', sigil: 'stone' },
        { id: 'sand', word: 'Песка', color: '#d2a865', sigil: 'sand' },
        { id: 'water', word: 'Воды', color: '#5c8fb0', sigil: 'water' },
        { id: 'dust', word: 'Пыли', color: '#b49a80', sigil: 'dust' },
        { id: 'moments', word: 'Мгновений', color: '#a985b3', sigil: 'moments' },
        { id: 'remembrance', word: 'Памяти', color: '#8fa078', sigil: 'remembrance' },
        { id: 'promise', word: 'Обещания', color: '#e3dccb', sigil: 'promise', provisional: true }
    ].map(h => Object.assign(h, { name: `Дом ${h.word}`, genitive: `Дома ${h.word}` }));

    const SIGIL_IDS = Object.keys(SIGILS);
    const STANDINGS = ['member', 'exile'];
    const DEFAULT_CUSTOM_COLOR = '#b8a27a';
    const HEX = /^#[0-9a-f]{6}$/i;

    function cleanWord(value) {
        return typeof value === 'string'
            ? value.trim().replace(/\s+/g, ' ').replace(/^(?:из\s+)?дома?\s+/i, '').slice(0, 60)
            : '';
    }

    function makeCustom(word, color, sigil) {
        return {
            id: 'custom',
            custom: true,
            word,
            name: `Дом ${word}`,
            genitive: `Дома ${word}`,
            color: HEX.test(color || '') ? color.toLowerCase() : DEFAULT_CUSTOM_COLOR,
            sigil: SIGIL_IDS.includes(sigil) ? sigil : 'crown'
        };
    }

    // Возвращает описание Дома персонажа или null.
    function resolveHouse(profile) {
        const p = profile && typeof profile === 'object' ? profile : {};
        const preset = HOUSES.find(h => h.id === p.house_key);
        if (preset) return Object.assign({ custom: false }, preset);
        if (p.house_key === 'custom') {
            const word = cleanWord(p.house_custom);
            if (word) return makeCustom(word, p.house_color, p.house_sigil);
        }
        // Старые профили: Дом записан только в каноническом имени («…из Дома Стекла»).
        const match = typeof p.full_name === 'string' && p.full_name.match(/(?:^|\s)из\s+дома?\s+([^,;]+)/i);
        if (match) {
            const word = cleanWord(match[1]);
            const known = HOUSES.find(h => h.word.toLowerCase() === word.toLowerCase());
            if (known) return Object.assign({ custom: false }, known);
            if (word) return makeCustom(word, p.house_color, p.house_sigil);
        }
        return null;
    }

    // noble — Кавалер, состоящий в Доме; exile — Кавалер-изгнанник; ignoble — Лансер.
    function getStanding(profile) {
        const p = profile && typeof profile === 'object' ? profile : {};
        if (p.estate !== 'cavalier') return 'ignoble';
        return p.house_standing === 'exile' ? 'exile' : 'noble';
    }

    function sigilSvg(id, options) {
        const o = options || {};
        const size = o.size || 24;
        const body = SIGILS[id] || SIGILS.crown;
        return `<svg viewBox="0 0 40 40" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${o.strokeWidth || 1.8}" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true" focusable="false">${body}</svg>`;
    }

    const STORAGE_KEY = 'ktbLivery';
    const BODY_CLASSES = ['ktb-noble', 'ktb-ignoble', 'ktb-exile'];

    // Нейтральная форма обращения обходится без родовых окончаний.
    function exileLabel(gender, house) {
        if (gender === 'female') return house ? `Изгнанница ${house.genitive}` : 'Изгнанница';
        if (gender === 'male') return house ? `Изгнанник ${house.genitive}` : 'Изгнанник';
        return house ? `Вне ${house.genitive}` : 'Без Дома';
    }

    // Состояние ливреи для оформления: классы body, цвет и подпись герба.
    function describe(profile) {
        const standing = getStanding(profile);
        const house = resolveHouse(profile);
        const gender = profile && profile.gender;
        let label = 'Приёмная общего доступа';
        if (standing === 'noble') label = house ? house.name : 'Благородное собрание';
        if (standing === 'exile') label = exileLabel(gender, house);
        return {
            standing,
            house: house ? { id: house.id, name: house.name, genitive: house.genitive, color: house.color, sigil: house.sigil, custom: house.custom } : null,
            label
        };
    }

    function applyState(state, target) {
        const body = target || (typeof document !== 'undefined' ? document.body : null);
        if (!body || !state) return;
        body.classList.remove(...BODY_CLASSES);
        if (state.standing === 'noble') body.classList.add('ktb-noble');
        else body.classList.add('ktb-ignoble');
        if (state.standing === 'exile') body.classList.add('ktb-exile');
        const color = state.house && HEX.test(state.house.color) ? state.house.color : '';
        if (color) body.style.setProperty('--ktb-livery', color);
        else body.style.removeProperty('--ktb-livery');
        renderCrest(state);
    }

    // Герб над пультом связи (#ktb-crest в index.html).
    function renderCrest(state) {
        if (typeof document === 'undefined') return;
        const crest = document.getElementById('ktb-crest');
        if (!crest) return;
        crest.textContent = '';
        crest.dataset.standing = state.standing;
        const sigil = document.createElement('span');
        sigil.className = 'ktb-crest-sigil';
        if (state.house && state.standing !== 'ignoble') sigil.innerHTML = sigilSvg(state.house.sigil, { size: 22 });
        else sigil.innerHTML = '<svg viewBox="0 0 40 40" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="9" width="22" height="22"/><path d="M14 16H26M14 21H26M14 26H22"/></svg>';
        const label = document.createElement('span');
        label.className = 'ktb-crest-label';
        label.textContent = state.label;
        crest.append(sigil, label);
    }

    function apply(profile, target) {
        const state = describe(profile);
        applyState(state, target);
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* хранилище недоступно */ }
        return state;
    }

    // Ранний вызов из index.html до загрузки профиля: убирает мигание оформления.
    function applyCached(target) {
        try {
            const state = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (state && state.standing) applyState(state, target);
        } catch (e) { /* нет кэша */ }
    }

    return {
        HOUSES,
        SIGILS,
        SIGIL_IDS,
        STANDINGS,
        DEFAULT_CUSTOM_COLOR,
        resolveHouse,
        getStanding,
        sigilSvg,
        describe,
        apply,
        applyCached,
        renderCrest
    };
});
