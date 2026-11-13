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
        // Знаки собственных Домов (список и подписи — CUSTOM_SIGIL_GROUPS ниже).
        crown: '<path d="M6 30 9 12 16 21 20 8 24 21 31 12 34 30Z M6 34H34"/>',
        tower: '<path d="M12 35V14H28V35M10 14V8H14V11H18V8H22V11H26V8H30V14M18 35V28H22V35"/>',
        blade: '<path d="M20 3 24 9V26H16V9Z M11 26H29M20 26V33M17 36H23"/>',
        wing: '<path d="M5 30C13 26 18 17 20 6 22 17 27 26 35 30M10 24C14 22 17 18 19 13M30 24C26 22 23 18 21 13"/>',
        star: '<path d="M20 4 23.5 15H35L25.5 22 29 33 20 26 11 33 14.5 22 5 15H16.5Z"/>',
        key: '<circle cx="13" cy="20" r="7"/><path d="M20 20H36M30 20V26M34 20V24"/>',
        scepter: '<path d="M20 12V36M16 36H24M14 16H26"/><circle cx="20" cy="8" r="4"/>',
        orb: '<circle cx="20" cy="24" r="10"/><path d="M10 24H30M20 14V6M17 9H23"/>',
        chalice: '<path d="M11 6H29C29 16 25 21 20 21 15 21 11 16 11 6ZM20 21V31M13 35H27M15 31H25"/>',
        ring: '<circle cx="20" cy="25" r="10"/><path d="M15 11 20 5 25 11 20 15Z"/>',
        scales: '<path d="M20 6V34M13 34H27M8 10H32M8 10 4 20H12ZM32 10 28 20H36Z"/>',
        banner: '<path d="M10 4V36M10 6H32L26 13 32 20H10"/>',
        shield: '<path d="M20 4 33 9V19C33 27 27 33 20 36 13 33 7 27 7 19V9ZM20 4V36M7 18H33"/>',
        anchor: '<circle cx="20" cy="7" r="3"/><path d="M20 10V35M13 15H27M6 24C6 31 13 35 20 35S34 31 34 24M6 24 4 28M6 24 9 27M34 24 36 28M34 24 31 27"/>',
        bell: '<path d="M10 30C12 26 12 14 20 10 28 14 28 26 30 30ZM8 30H32M18 33A2 2 0 0 0 22 33M20 6V10"/>',
        wolf: '<path d="M8 6 14 16 20 13 26 16 32 6 30 22 20 34 10 22Z"/><path d="M15 21 18 22M25 21 22 22M18 29H22"/>',
        stag: '<path d="M20 34 16 22H24ZM16 22C11 20 9 15 9 6M9 12H5M9 16C12 16 14 14 14 10M24 22C29 20 31 15 31 6M31 12H35M31 16C28 16 26 14 26 10"/>',
        boar: '<path d="M8 12C8 26 14 34 20 34S32 26 32 12L26 17H14Z"/><path d="M14 26C11 24 10 21 11 18M26 26C29 24 30 21 29 18"/><path d="M16 22H17M23 22H24"/>',
        serpent: '<path d="M8 34C8 26 30 28 30 20S10 14 12 8C13 5 18 4 21 6"/><path d="M21 6 25 5M21 6 24 9"/>',
        bear: '<ellipse cx="20" cy="26" rx="8" ry="7"/><circle cx="11" cy="15" r="3"/><circle cx="17" cy="10" r="3"/><circle cx="23" cy="10" r="3"/><circle cx="29" cy="15" r="3"/>',
        ram: '<path d="M20 14C14 6 4 8 6 16 7 21 13 21 13 16M20 14C26 6 36 8 34 16 33 21 27 21 27 16M14 18 20 34 26 18"/>',
        horse: '<path d="M12 35H30M14 35C14 28 18 25 18 21L11 23 9 18 18 6 24 7C31 9 32 22 28 35"/><path d="M20 12H21"/>',
        spider: '<circle cx="20" cy="17" r="4"/><circle cx="20" cy="27" r="5"/><path d="M16 16 6 9M16 20H5M16 24 7 32M24 16 34 9M24 20H35M24 24 33 32"/>',
        fish: '<path d="M6 20C12 10 24 10 30 20 24 30 12 30 6 20ZM30 20 36 13V27Z"/><path d="M12 18H13"/>',
        claw: '<path d="M10 34C12 24 10 14 6 8M20 34C22 22 20 12 16 4M30 34C31 25 30 16 26 10"/>',
        eagle: '<circle cx="20" cy="8" r="2.5"/><path d="M20 11 17 15 20 30 23 15Z"/><path d="M17 15C12 14 6 10 4 6 6 16 10 20 18 22M23 15C28 14 34 10 36 6 34 16 30 20 22 22M17 30 14 35M23 30 26 35M20 30V35"/>',
        raven: '<path d="M6 30 12 26C10 20 12 13 19 11L24 8 30 9 34 12 28 14C30 20 27 27 20 29L12 30Z"/><path d="M14 30 12 35M19 29V35M27 10.5H28"/>',
        owl: '<path d="M10 8 14 12H26L30 8V24C30 31 25 35 20 35S10 31 10 24Z"/><circle cx="16" cy="19" r="3.5"/><circle cx="24" cy="19" r="3.5"/><path d="M19 25 20 27 21 25"/>',
        swan: '<path d="M5 26C9 33 27 34 34 25 28 27 22 27 19 24 16 21 18 15 21 12 24 9 24 5 20 5 17 5 16 8 17 9"/><path d="M17 7 13 8 17 9"/>',
        feather: '<path d="M8 34 30 6C34 14 30 24 18 26ZM14 28 24 16M12 31 8 30"/>',
        phoenix: '<path d="M20 34V20M20 20C14 16 8 18 6 10 12 12 16 10 20 4 24 10 28 12 34 10 32 18 26 16 20 20Z"/><path d="M14 34C16 30 18 30 20 34 22 30 24 30 26 34"/>',
        sun: '<circle cx="20" cy="20" r="7"/><path d="M20 4V9M20 31V36M4 20H9M31 20H36M8.7 8.7 12.2 12.2M27.8 27.8 31.3 31.3M8.7 31.3 12.2 27.8M27.8 12.2 31.3 8.7"/>',
        moon: '<path d="M26 6A15 15 0 1 0 26 34 12 12 0 1 1 26 6Z"/>',
        comet: '<circle cx="27" cy="13" r="5"/><path d="M23 17 6 34M25 19 12 34M21 15 6 26"/>',
        eclipse: '<circle cx="20" cy="20" r="11"/><path d="M27 12A9 9 0 1 1 16 25 11 11 0 0 0 27 12Z" fill="currentColor" stroke="none" opacity="0.45"/><path d="M20 3V6M20 34V37M3 20H6M34 20H37"/>',
        planet: '<circle cx="20" cy="20" r="8"/><ellipse cx="20" cy="20" rx="17" ry="6" transform="rotate(-20 20 20)"/>',
        constellation: '<path d="M6 30 14 22 22 26 30 12 34 18"/><g fill="currentColor" stroke="none"><circle cx="6" cy="30" r="2"/><circle cx="14" cy="22" r="2"/><circle cx="22" cy="26" r="2"/><circle cx="30" cy="12" r="2.4"/><circle cx="34" cy="18" r="1.6"/></g>',
        northstar: '<path d="M20 3 23 17 37 20 23 23 20 37 17 23 3 20 17 17Z"/>',
        oak: '<path d="M20 36V12M20 30C12 28 10 22 13 20 8 18 10 12 14 13 12 7 18 5 20 8 22 5 28 7 26 13 30 12 32 18 27 20 30 22 28 28 20 30Z"/>',
        rose: '<circle cx="20" cy="15" r="9"/><path d="M20 15C17 12 20 9 22 11 25 14 20 19 16 16M20 24V36M20 29C16 27 13 28 12 30M20 31C24 29 27 30 28 32"/>',
        lily: '<path d="M20 4C16 10 16 16 20 22 24 16 24 10 20 4ZM20 22C14 22 8 20 8 13 8 10 12 9 13 12M20 22C26 22 32 20 32 13 32 10 28 9 27 12M12 24H28M20 24V30M16 30C16 34 24 34 24 30"/>',
        wheat: '<path d="M20 36V6M20 10C17 8 16 5 17 3M20 10C23 8 24 5 23 3M20 16C16 15 14 11 15 8M20 16C24 15 26 11 25 8M20 23C16 22 14 18 15 15M20 23C24 22 26 18 25 15M20 30C16 29 14 25 15 22M20 30C24 29 26 25 25 22"/>',
        pine: '<path d="M20 4 10 16H15L7 26H16V34H24V26H33L25 16H30Z"/>',
        thorn: '<path d="M5 30C12 22 28 18 35 10M11 25 9 20M17 21 18 16M23 18 21 13M29 14 30 9M14 23 17 27M21 19 25 22M27 15 31 18"/>',
        laurel: '<path d="M14 34C6 28 5 17 10 8M26 34C34 28 35 17 30 8"/><path d="M10 28C7 27 6 25 6 23 9 23 11 25 10 28ZM8 21C5 19 5 17 5 15 8 16 9 18 8 21ZM9 14C7 12 8 9 9 8 11 10 11 12 9 14ZM30 28C33 27 34 25 34 23 31 23 29 25 30 28ZM32 21C35 19 35 17 35 15 32 16 31 18 32 21ZM31 14C33 12 32 9 31 8 29 10 29 12 31 14Z"/>',
        flame: '<path d="M20 4C24 11 31 15 31 24A11 11 0 0 1 9 24C9 18 13 15 15 10 16 15 18 17 20 17 21 12 19 8 20 4Z"/><path d="M20 34C16 33 15 29 17 26 18 28 20 28 21 25 24 28 24 33 20 34Z"/>',
        wave: '<path d="M4 26C8 18 14 16 18 20 15 22 16 26 20 26 26 26 30 18 26 12 32 14 36 20 36 26"/><path d="M4 32C9 30 14 34 20 32S31 30 36 32"/>',
        mountain: '<path d="M3 34 15 12 22 24 27 16 37 34ZM12 17 15 20 18 17"/>',
        lightning: '<path d="M23 3 9 22H19L15 37 31 16H21Z"/>',
        snowflake: '<path d="M20 4V36M6 12 34 28M6 28 34 12M16 7 20 11 24 7M16 33 20 29 24 33"/>',
        drop: '<path d="M20 4C26 14 31 20 31 25A11 11 0 0 1 9 25C9 20 14 14 20 4Z"/><path d="M14 26C14 29 16 31 19 31"/>',
        whirl: '<path d="M20 20C20 17 24 17 24 20 24 25 16 25 16 20 16 13 28 13 28 20 28 29 12 29 12 20 12 9 33 9 33 20"/>',
        volcano: '<path d="M4 34 14 18H26L36 34Z"/><path d="M18 12C17 8 20 8 19 4M22 12C23 9 21 7 23 4"/>',
        swords: '<path d="M7 7 29 29M33 7 11 29M25 31 31 25M15 31 9 25M30 30 34 34M10 30 6 34"/>',
        axe: '<path d="M14 3V37"/><path d="M14 10 30 4C35 13 35 23 30 32L14 24Z"/>',
        spear: '<path d="M20 12V37M20 3 25 12H15ZM15 16H25"/>',
        bow: '<path d="M12 4C30 10 30 30 12 36ZM8 20H34M34 20 30 17M34 20 30 23"/>',
        hammer: '<rect x="7" y="5" width="26" height="9" rx="1"/><path d="M12 5V14M28 5V14M20 14V36M16 36H24"/>',
        lance: '<path d="M6 34 30 10M30 10 35 4 28 7ZM10 26 17 23 14 30Z"/>',
        mace: '<circle cx="20" cy="11" r="7"/><path d="M20 18V36M14 36H26M20 2V4M27 4 25.5 5.5M29 11H27M13 4 14.5 5.5M11 11H13"/>',
        gear: '<circle cx="20" cy="20" r="6"/><path d="M18 4H22L23 9 27 10.5 31 7.5 32.5 9 29.5 13 31 17 36 18V22L31 23 29.5 27 32.5 31 31 32.5 27 29.5 23 31 22 36H18L17 31 13 29.5 9 32.5 7.5 31 10.5 27 9 23 4 22V18L9 17 10.5 13 7.5 9 9 7.5 13 10.5 17 9Z"/>',
        reactor: '<circle cx="20" cy="20" r="3"/><ellipse cx="20" cy="20" rx="16" ry="6"/><ellipse cx="20" cy="20" rx="16" ry="6" transform="rotate(60 20 20)"/><ellipse cx="20" cy="20" rx="16" ry="6" transform="rotate(-60 20 20)"/>',
        helm: '<path d="M8 30V18C8 10 13 5 20 5S32 10 32 18V30L26 35H14ZM11 18H29L26 23H14ZM20 28V35"/>',
        rocket: '<path d="M20 3C26 9 27 18 25 27H15C13 18 14 9 20 3Z"/><circle cx="20" cy="14" r="3"/><path d="M15 21 9 29V31H15M25 21 31 29V31H25M17 27 18 35 20 32 22 35 23 27"/>',
        satellite: '<rect x="15" y="15" width="10" height="10" transform="rotate(45 20 20)"/><path d="M14 14 7 7M7 7 3 11 10 18M26 26 33 33M33 33 37 29 30 22M26 14 30 10"/><circle cx="31" cy="9" r="2"/>',
        crosshair: '<circle cx="20" cy="20" r="12"/><circle cx="20" cy="20" r="3"/><path d="M20 3V12M20 28V37M3 20H12M28 20H37"/>',
        circuit: '<path d="M8 10H16L22 16H32M8 20H26M8 30H14L20 24H32"/><circle cx="6" cy="10" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="6" cy="30" r="2"/><circle cx="34" cy="16" r="2"/><circle cx="28" cy="20" r="2"/><circle cx="34" cy="24" r="2"/>',
        eye: '<path d="M3 20C10 10 30 10 37 20 30 30 10 30 3 20Z"/><circle cx="20" cy="20" r="5"/><circle cx="20" cy="20" r="1.5" fill="currentColor"/>',
        hive: '<path d="M20 4 27 8V16L20 20 13 16V8ZM13 16 20 20V28L13 32 6 28V20ZM27 16 34 20V28L27 32 20 28V20Z"/>',
        cross: '<path d="M16 4H24V16H36V24H24V36H16V24H4V16H16Z"/>',
        chevron: '<path d="M4 30 20 12 36 30M4 22 20 4 36 22"/>',
        lozenge: '<path d="M20 4 30 20 20 36 10 20ZM20 12 25 20 20 28 15 20Z"/>',
        triad: '<path d="M20 5 34 31H6Z"/><circle cx="20" cy="22" r="5"/>',
        ouroboros: '<path d="M31 14A12 12 0 1 1 26 9.5"/><path d="M26 9.5 31 7 30.5 13Z"/>',
        chain: '<rect x="4" y="14" width="18" height="12" rx="6"/><rect x="18" y="14" width="18" height="12" rx="6"/>',
        wheel: '<circle cx="20" cy="20" r="14"/><circle cx="20" cy="20" r="3"/><path d="M20 6V17M20 23V34M6 20H17M23 20H34M10 10 17.9 17.9M22.1 22.1 30 30M10 30 17.9 22.1M22.1 17.9 30 10"/>',
        trident: '<path d="M20 12V37M10 6V14C10 18 14 20 20 20S30 18 30 14V6M20 3V20M8 8 10 5 12 8M18 6 20 3 22 6M28 8 30 5 32 8"/>',
        gate: '<path d="M6 36V12C6 6 34 6 34 12V36M6 16H34M12 16V36M28 16V36M17 36V24C17 20 23 20 23 24V36"/>'
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
    // Знаки для своего Дома по группам; знаки Великих Домов заняты и сюда не входят.
    const CUSTOM_SIGIL_GROUPS = [
        { title: "Регалии", sigils: ["crown", "tower", "key", "scepter", "orb", "chalice", "ring", "scales", "banner", "shield", "anchor", "bell"] },
        { title: "Звери", sigils: ["wolf", "stag", "boar", "serpent", "bear", "ram", "horse", "spider", "fish", "claw"] },
        { title: "Птицы", sigils: ["wing", "eagle", "raven", "owl", "swan", "feather", "phoenix"] },
        { title: "Небо", sigils: ["star", "sun", "moon", "comet", "eclipse", "planet", "constellation", "northstar"] },
        { title: "Растения", sigils: ["oak", "rose", "lily", "wheat", "pine", "thorn", "laurel"] },
        { title: "Стихии", sigils: ["flame", "wave", "mountain", "lightning", "snowflake", "drop", "whirl", "volcano"] },
        { title: "Оружие", sigils: ["blade", "swords", "axe", "spear", "bow", "hammer", "lance", "mace", "trident"] },
        { title: "Механика", sigils: ["gear", "reactor", "helm", "rocket", "satellite", "crosshair", "circuit", "eye", "hive"] },
        { title: "Фигуры", sigils: ["cross", "chevron", "lozenge", "triad", "ouroboros", "chain", "wheel", "gate"] }
    ];
    const SIGIL_LABELS = {
        crown: "Корона",
        tower: "Башня",
        key: "Ключ",
        scepter: "Скипетр",
        orb: "Держава",
        chalice: "Чаша",
        ring: "Перстень",
        scales: "Весы",
        banner: "Знамя",
        shield: "Щит",
        anchor: "Якорь",
        bell: "Колокол",
        wolf: "Волк",
        stag: "Олень",
        boar: "Вепрь",
        serpent: "Змей",
        bear: "Медвежья лапа",
        ram: "Овен",
        horse: "Конь",
        spider: "Паук",
        fish: "Рыба",
        claw: "Когти",
        wing: "Крыло",
        eagle: "Орёл",
        raven: "Ворон",
        owl: "Сова",
        swan: "Лебедь",
        feather: "Перо",
        phoenix: "Феникс",
        star: "Звезда",
        sun: "Солнце",
        moon: "Полумесяц",
        comet: "Комета",
        eclipse: "Затмение",
        planet: "Планета",
        constellation: "Созвездие",
        northstar: "Путеводная звезда",
        oak: "Дубовый лист",
        rose: "Роза",
        lily: "Лилия",
        wheat: "Колос",
        pine: "Ель",
        thorn: "Терновник",
        laurel: "Лавровый венок",
        flame: "Пламя",
        wave: "Волна",
        mountain: "Гора",
        lightning: "Молния",
        snowflake: "Снежинка",
        drop: "Капля",
        whirl: "Вихрь",
        volcano: "Вулкан",
        blade: "Клинок",
        swords: "Скрещённые мечи",
        axe: "Секира",
        spear: "Копьё",
        bow: "Лук",
        hammer: "Молот",
        lance: "Рыцарское копьё",
        mace: "Булава",
        trident: "Трезубец",
        gear: "Шестерня",
        reactor: "Реактор",
        helm: "Шлем меха",
        rocket: "Ракета",
        satellite: "Спутник",
        crosshair: "Прицел",
        circuit: "Схема",
        eye: "Всевидящее око",
        hive: "Соты",
        cross: "Крест",
        chevron: "Стропила",
        lozenge: "Ромбы",
        triad: "Триада",
        ouroboros: "Уроборос",
        chain: "Цепь",
        wheel: "Колесо",
        gate: "Врата"
    };
    const CUSTOM_SIGIL_IDS = CUSTOM_SIGIL_GROUPS.flatMap(g => g.sigils);
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
        CUSTOM_SIGIL_GROUPS,
        CUSTOM_SIGIL_IDS,
        SIGIL_LABELS,
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
