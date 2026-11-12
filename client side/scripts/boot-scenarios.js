(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BootScenarios = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const THEMES = ['green', 'yellow', 'ktb'];
    const GENDERS = ['female', 'male', 'neutral'];
    const ESTATES = ['cavalier', 'lancer'];

    const GREEN_LINES = [
        '> SYSTEM COLD BOOT INITIATED',
        '> BIOS v3.14.159 -- GMS GEN5 ARCHITECTURE',
        '> MEMORY CHECK... 64TB O.RAM -- [OK]',
        '> NEURAL CO-PROCESSOR... ONLINE',
        '> CRYPTO-SUBSTRATE HANDSHAKE... VERIFIED',
        '> QUANTUM ENTANGLEMENT LINK... STABLE',
        '> LOADING KERNEL: gms-os/7.2.1-xeno',
        '> MOUNTING /dev/cortex0 ... SUCCESS',
        '> SCANNING OMNI-BAND FREQUENCIES...',
        '> SIGNAL LOCK ACQUIRED -- FREQ 140.15',
        '> AUTH: BIOMETRIC + NEURAL HASH [OK]',
        '> FIREWALL: ACTIVE -- 0 BREACHES',
        '> TERMINAL SESSION [0x4521] READY'
    ];

    const YELLOW_LINES = [
        'IPS-N // ПОЛЕВОЙ ТЕРМИНАЛ ДАЛЬНЕГО РЕЙСА',
        'ревизия корпуса 7.4.2 • режим: автономный',
        '',
        '> силовая шина .............................. ОНЛАЙН',
        '> броня терминала: пылевой фильтр ........... ОЧИЩЕН',
        '> реактор: холодный запуск .................. СТАБИЛЕН',
        '> навигация: карта дальнего сектора .......... ЗАГРУЖЕНА',
        '> омнисвязь: узел ближайшего маяка ........... ЗАХВАЧЕН',
        '> канал 140.15 ............................... ОТКРЫТ',
        '> идентификация пилота ....................... ПОДТВЕРЖДЕНА',
        '> боекомплект интерфейса ..................... ПОЛНЫЙ',
        '> полевой ремонт: диагностика ................ ГОТОВА',
        '> терминал IPS-N ............................. К РАБОТЕ'
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
            return {
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
                    '> печать: отсутствует → сословие: НЕБЛАГОРОДНЫЙ',
                    `> прошение зарегистрировано: № ${petition}`,
                    `> очередь: ${queueNumber}. Дома рассматривают обращения в порядке прецедента.`,
                    '> терпение — добродетель. Ожидайте.'
                ],
                greeting: `«Прошение от ${name} принято к рассмотрению. Ожидайте вызова приёмной.»`
            };
        }

        return {
            theme: 'ktb',
            estate: 'cavalier',
            system: 'ORACULUM-5.5.0',
            bannerTitle: 'SENESCHAL',
            bannerSubtitle: 'ORACULUM-5.5.0 • ЦЕРЕМОНИАЛ АУДИЕНЦИЙ',
            progressLabel: 'ПРИГОТОВЛЕНИЕ АУДИЕНЦИИ',
            confirmLabel: 'Торжественно подтверждаю свой запрос аудиенции',
            typingSpeed: 10,
            lines: [
                'СЕНЕШАЛЬ // церемониал аудиенций • ред. IX, оттиск 3',
                'год 5016u • летопись Дома: 812 от Возведения',
                '',
                '> ядро пробуждено .................................. ОК',
                '> печать дома: воск цел, оттиск сверен ............. ПОДЛИННО',
                '> баронская книга: поиск титула .................... НАЙДЕН',
                `>   ${addressedName}`,
                '> узы: прочтение завершено ......................... ВОЛК — точность, холод',
                '> патент кирасира .................................. ДЕЙСТВИТЕЛЕН',
                '> омнисеть: узел Карракиса ......................... РУКОПОЖАТИЕ',
                '> протоколы Союза: совместимость ................... ВКЛ (по уступкам)',
                '> этикет: 96 домов • 12 408 форм обращения ......... ЗАГРУЖЕНО',
                '> ассистент: комп/кон • оковы: не требуются',
                '> клятва: «Слово моё — печать моя»',
                '> свеча зажжена. Аудиенция открыта.'
            ],
            greeting: `«Доброго часа, ${addressedName}. ${house || 'Церемониал Дома'} свидетельствует ваше прибытие. Изложите суть прошения, пока горит свеча.»`
        };
    }

    function buildScenario(theme, profile) {
        const normalizedTheme = THEMES.includes(theme) ? theme : 'yellow';
        if (normalizedTheme === 'ktb') return buildKtbScenario(profile);

        if (normalizedTheme === 'green') {
            return {
                theme: 'green',
                system: 'GMS-4521',
                bannerTitle: 'GMS-4521',
                bannerSubtitle: 'GENERAL MASSIVE SYSTEMS • TERMINAL INTERFACE',
                progressLabel: 'INITIALIZING INTERFACE',
                confirmLabel: 'Подтвердить личность',
                typingSpeed: 24,
                lines: GREEN_LINES.slice(),
                greeting: ''
            };
        }

        return {
            theme: 'yellow',
            system: 'IPS-N-7.4.2',
            bannerTitle: 'IPS-NORTHSTAR',
            bannerSubtitle: 'ПОЛЕВАЯ СВЯЗЬ • ДАЛЬНИЙ РЕЙС',
            progressLabel: 'ПОДГОТОВКА ТЕРМИНАЛА',
            confirmLabel: 'Подтвердить личность',
            typingSpeed: 16,
            lines: YELLOW_LINES.slice(),
            greeting: '«Терминал готов. Держите канал открытым, пилот.»'
        };
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
