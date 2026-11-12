(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BootScenarios = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const THEMES = ['green', 'yellow', 'ktb'];
    const GENDERS = ['female', 'male', 'neutral'];
    const ESTATES = ['cavalier', 'lancer'];

    // Тайминг терминала: текст медленно «проявляется» на экране ~5 секунд
    // (см. bootTextFadeIn в index_styles.css), после печати держится ещё ~2 секунды
    // на чтение, а исчезает ~2 секунды (bootTextFadeOut).
    const MIN_TYPING_SPEED_MS = 16; // не быстрее ~24 мс на символ в среднем — спокойный темп печати
    const TERMINAL_READING_HOLD_MS = 2000;

    // Задаёт typingSpeed и добавляет паузу на чтение. Скорость печати не опускается
    // ниже MIN_TYPING_SPEED_MS: в boot.js средняя задержка на символ ≈ speed + min(15, speed) / 2.
    function applyReadableTiming(scenario) {
        scenario.typingSpeed = MIN_TYPING_SPEED_MS;
        scenario.holdMs = TERMINAL_READING_HOLD_MS;
        return scenario;
    }

    const GREEN_LINES = [
        '> ИНИЦИАЦИЯ ХОЛОДНОГО ЗАПУСКА СИСТЕМЫ',
        '> BIOS v3.14.159 -- GMS GEN5 ARCHITECTURE',
        '> ПРОВЕРКА ПАМЯТИ... 64TB O.RAM -- [OK]',
        '> НЕЙРОСОПРОЦЕССОР .................. ОНЛАЙН',
        '> КРИПТО-СУБСТРАТНОЕ «РУКОПОЖАТИЕ»... ПОДТВЕРЖДЕНО',
        '> СВЯЗЬ КВАНТОВОЙ ЗАПУТАННОСТИ....... СТАБИЛЬНО',
        '> ЗАГРУЗКА ЯДРА: gms-os/7.2.1-xeno',
        '> МОНТАЖ /dev/cortex0 ............... УСПЕШНО',
        '> СКАНИРОВАНИЕ ЧАСТОТ В ШИРОКОМ ДИАПАЗОНЕ...',
        '> СИГНАЛ ЗАХВАЧЕН -- ЧАСТОТА 140.15',
        '> АВТОРИЗАЦИЯ: БИОМЕТРИЧЕСКИЙ + НЕЙРОННЫЙ ХЭШ [OK]',
        '> МЕЖСЕТЕВОЙ ЭКРАН: АКТИВЕН — 0 ПРОРЫВОВ',
        '> СЕАНС ТЕРМИНАЛА ​​[0x4521] ГОТОВ'
    ];

    const YELLOW_LINES = [
        'IPS-N // ПОЛЕВОЙ ТЕРМИНАЛ ДАЛЬНИХ РУБЕЖЕЙ',
        'ревизия ядра 7.4.2 • режим: автономный',
        '',
        '> Ближайший узел ............................. ОНЛАЙН',
        '> Состояние маяка связи ...................... В ПОРЯДКЕ',
        '> Сквозное шифрование через омнисеть ......... СТАБИЛЬНО',
        '> Навигация: составление маршрута ............ ЗАВЕРШЕНО',
        '> Омнисвязь: узел ближайшего маяка ........... ЗАХВАЧЕН',
        '> Проверка зашифрованного канала ............. ОТКРЫТ',
        '> Идентификация пилота ....................... ВАЛИДНЫЙ',
        '> Статус доступа по лицензии ................. ПОЛНЫЙ',
        '> Протокол IPS-N 10.1 ........................ ГОТОВ',
        '> Терминал IPS-N ............................. ОЖИДАНИЕ ОТВЕТА'
    ];

    function normalizeProfile(profile) {
        const source = profile && typeof profile === 'object' ? profile : {};
        return {
            slot_number: Number.isInteger(Number(source.slot_number)) ? Number(source.slot_number) : 1,
            callsign: typeof source.callsign === 'string' ? source.callsign.trim() : '',
            full_name: typeof source.full_name === 'string' ? source.full_name.trim().replace(/\s+/g, ' ') : '',
            mech_name: typeof source.mech_name === 'string' ? source.mech_name.trim() : '',
            gender: GENDERS.includes(source.gender) ? source.gender : 'neutral',
            estate: ESTATES.includes(source.estate) ? source.estate : 'lancer',
            is_nhp: source.is_nhp === 1 || source.is_nhp === '1' || source.is_nhp === true
        };
    }

    function getCanonicalName(profile) {
        const normalized = normalizeProfile(profile);
        return (normalized.full_name || normalized.callsign || 'Безымянный проситель')
            .replace(/^(?:леди|лорд)\s+/i, '');
    }

    function getHouse(profile) {
        const match = getCanonicalName(profile).match(/(?:^|\s)из\s+((?:Дома?|дома?)\s+[^,;]+)/i);
        if (!match) return '';
        return match[1].replace(/^дома?\s+/i, 'Дом ');
    }

    function getTitle(gender) {
        if (gender === 'female') return 'леди';
        if (gender === 'male') return 'лорд';
        return '';
    }

    function petitionFor(profile) {
        const normalized = normalizeProfile(profile);
        const source = `${normalized.callsign}|${normalized.full_name}`;
        let hash = 0;
        for (let i = 0; i < source.length; i++) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
        const number = source ? 100 + (Math.abs(hash) % 900) : 214;
        const letters = ['А', 'Б', 'В', 'Г', 'Д'];
        return `${number}-${letters[Math.abs(hash) % letters.length]}`;
    }

    function buildKtbScenario(profile) {
        const normalized = normalizeProfile(profile);
        const name = getCanonicalName(normalized);
        const house = getHouse(normalized);
        const title = normalized.estate === 'cavalier' ? getTitle(normalized.gender) : '';
        const addressedName = `${title ? `${title} ` : ''}${name}`;

        if (normalized.estate === 'lancer') {
            const petition = petitionFor(normalized);
            const queueNumber = petition.split('-')[0];
            return applyReadableTiming({
                theme: 'ktb',
                estate: 'lancer',
                system: 'ORACULUM-5.5.0',
                bannerTitle: 'PURSUIVANT',
                bannerSubtitle: 'ORACULUM-5.5.0 • ПРИЁМНАЯ ОБЩЕГО ДОСТУПА',
                progressLabel: 'РЕГИСТРАЦИЯ ПРОШЕНИЯ',
                confirmLabel: 'Подтвердить прошение',
                typingSpeed: 12,
                lines: [
                    'ПУРСИВАНТ // приёмная общего доступа',
                    'ORACULUM-5.5.0 • реестр внешних обращений',
                    '',
                    '> Печать: отсутствует → сословие: НЕБЛАГОРОДНЫЙ/ОТОЗВАННЫЙ',
                    `> Прошение зарегистрировано: № ${petition}`,
                    `> Очередь: ${queueNumber}. Дома рассматривают обращения в порядке прецедента.`,
                    '> Терпение есть добродетель. Ожидайте.'
                ],
                greeting: `Прошение от ${name} заполнено. Подтвердите прошение и ожидайте принятия к рассмотрению.`
            });
        }

        return applyReadableTiming({
            theme: 'ktb',
            estate: 'cavalier',
            system: 'ORACULUM-5.5.0',
            bannerTitle: 'SENESCHAL',
            bannerSubtitle: 'ORACULUM-5.5.0 • ЦЕРЕМОНИАЛ АУДИЕНЦИЙ',
            progressLabel: 'ПРИГОТОВЛЕНИЕ АУДИЕНЦИИ',
            confirmLabel: 'Торжественно подтверждаю свой запрос на аудиенцию',
            typingSpeed: 10,
            lines: [
                'СЕНЕШАЛЬ // церемониал аудиенций • ред. IX, оттиск 3',
                'год 5027u • летопись Дома: 823 от Возведения',
                '',
                '> Пробуждение ядра ................................. ОК',
                '> Печать дома: структура цела, оттиск сверен ....... ПОДЛИННО',
                '> Бюро баронов: поиск титула ....................... НАЙДЕН',
                `>   ${addressedName}`,
                '> Узы: прочтение завершено ......................... РОДОСЛОВНАЯ НАЙДЕНА',
                '> Лицензия кавалера ................................ ДЕЙСТВИТЕЛЬНА',
                '> Омнисеть: узел Карракиса ......................... РУКОПОЖАТИЕ',
                '> Протоколы Союза: совместимость ................... ВКЛ (по уступкам)',
                '> Этикет: 96 домов • 12 408 форм обращения ......... ЗАГРУЖЕНО',
                '> Ассистент: комп/кон • оковы: не требуются',
                '> Клятва: Слово моё - печать моя',
                '> Свеча зажжена. Аудиенция открыта.'
            ],
            greeting: `С возвращением, ${addressedName}. ${house || 'Церемониал Дома'} свидетельствует ваше прибытие. Подтвердите ваш запрос на аудиенцию.`
        });
    }

    function buildScenario(theme, profile) {
        const normalizedTheme = THEMES.includes(theme) ? theme : 'yellow';
        if (normalizedTheme === 'ktb') return buildKtbScenario(profile);

        if (normalizedTheme === 'green') {
            return applyReadableTiming({
                theme: 'green',
                system: 'GMS-4521',
                bannerTitle: 'GMS-4521',
                bannerSubtitle: 'GENERAL MASSIVE SYSTEMS • ИНТЕРФЕЙС ТЕРМИНАЛА',
                progressLabel: 'ИНИЦИАЛИЗАЦИЯ ИНТЕРФЕЙСА',
                confirmLabel: 'Подтвердить личность',
                typingSpeed: 24,
                lines: GREEN_LINES.slice(),
                greeting: ''
            });
        }

        return applyReadableTiming({
            theme: 'yellow',
            system: 'IPS-N-7.4.2',
            bannerTitle: 'IPS-NORTHSTAR',
            bannerSubtitle: 'ПОЛЕВАЯ СВЯЗЬ • ДАЛЬНИЙ РУБЕЖ',
            progressLabel: 'ПОДГОТОВКА ТЕРМИНАЛА',
            confirmLabel: 'Подтвердить личность',
            typingSpeed: 16,
            lines: YELLOW_LINES.slice(),
            greeting: 'Терминал готов. Подтвердите свою личность, с помощью клавиши ниже.'
        });
    }

    async function loadContext(apiUrl, options) {
        const settings = options || {};
        const fallback = { theme: 'yellow', profile: normalizeProfile(null), skipBoot: false };
        if (!apiUrl || typeof fetch !== 'function') return fallback;

        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timeout = setTimeout(() => controller && controller.abort(), settings.timeout || 3000);
        const fetchOptions = { credentials: 'include', signal: controller ? controller.signal : undefined };

        try {
            const results = await Promise.allSettled([
                fetch(`${apiUrl}/user-settings`, fetchOptions),
                fetch(`${apiUrl}/pilot-profiles/active`, fetchOptions)
            ]);
            let theme = fallback.theme;
            let profile = fallback.profile;
            let skipBoot = false;

            if (results[0].status === 'fulfilled' && results[0].value.ok) {
                const data = await results[0].value.json();
                if (THEMES.includes(data.theme)) theme = data.theme;
                skipBoot = data.skip_boot === 1 || data.skip_boot === '1' || data.skip_boot === true;
            }
            if (results[1].status === 'fulfilled' && results[1].value.ok) {
                const data = await results[1].value.json();
                profile = normalizeProfile(data.profile);
            }
            return { theme, profile, skipBoot };
        } catch (error) {
            return fallback;
        } finally {
            clearTimeout(timeout);
        }
    }

    return {
        buildScenario,
        getCanonicalName,
        getHouse,
        loadContext,
        normalizeProfile,
        petitionFor
    };
});
