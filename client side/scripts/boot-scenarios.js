(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.BootScenarios = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const THEMES = ['green', 'yellow', 'ktb', 'horus', 'ssc', 'ha'];
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

    // GMS: «гарантированное качество, универсальное лицензирование, полное покрытие».
    const GREEN_LINES = [
        '> ХОЛОДНЫЙ ЗАПУСК · GMS-OS 7.2 · СТАНДАРТНАЯ СБОРКА',
        '> ПРОВЕРКА ЦЕЛОСТНОСТИ ОБОРУДОВАНИЯ ........... [OK]',
        '> ЛИЦЕНЗИЯ GMS: УНИВЕРСАЛЬНАЯ · УРОВЕНЬ 0 ..... ДЕЙСТВИТЕЛЬНА',
        '> ШАБЛОН РАМЫ: EVEREST · ГАЛАКТИЧЕСКИЙ СТАНДАРТ',
        '> ОМНИСЕТЬ: УЗЕЛ СОЮЗА ........................ СИНХРОНИЗИРОВАН',
        '> ШИФРОВАНИЕ КАНАЛА: СТАНДАРТ СОЮЗА ........... АКТИВНО',
        '> СКАНИРОВАНИЕ ЧАСТОТ В ШИРОКОМ ДИАПАЗОНЕ...',
        '> СИГНАЛ ЗАХВАЧЕН · ЧАСТОТА 140.15',
        '> ИДЕНТИФИКАЦИЯ ПИЛОТА: ЛИЦЕНЗИЯ + БИОМЕТРИЯ ... [OK]',
        '> ГАРАНТИРОВАННОЕ КАЧЕСТВО · ПОЛНОЕ ПОКРЫТИЕ',
        '> СЕАНС ТЕРМИНАЛА [0x4521] ГОТОВ'
    ];

    // IPS-N: грузоперевозки, конвои и «Альбатрос»; девиз — «Твой друг в недружелюбном море».
    const YELLOW_LINES = [
        'IPS-NORTHSTAR // ТЕРМИНАЛ КОНВОЙНОЙ СВЯЗИ',
        'ревизия 7.4.2 • «Твой друг в недружелюбном море»',
        '',
        '> Маяк ближайшего узла ........................ ОНЛАЙН',
        '> Торговый тракт: навигационные данные ........ ПРИНЯТЫ',
        '> Конвойный реестр IPS-N ...................... СИНХРОНИЗИРОВАН',
        '> Сводка «Альбатроса»: пиратская активность .... НИЗКАЯ',
        '> Омнисвязь: канал через маяк ................. ЗАХВАЧЕН',
        '> Сквозное шифрование канала .................. СТАБИЛЬНО',
        '> Идентификация пилота ........................ ПОДТВЕРЖДЕНА',
        '> Протокол IPS-N 10.1 ......................... ГОТОВ',
        '> Терминал IPS-N .............................. ОЖИДАНИЕ ОТВЕТА'
    ];

    const STANDINGS = ['member', 'exile'];
    const HEX = /^#[0-9a-f]{6}$/i;
    const PASSIONS = ['Брокера', 'Строителя', 'Шута', 'Арлекина', 'Мага', 'Следопыта', 'Титана', 'Волка'];
    const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

    function normalizeProfile(profile) {
        const source = profile && typeof profile === 'object' ? profile : {};
        const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
        return {
            slot_number: Number.isInteger(Number(source.slot_number)) ? Number(source.slot_number) : 1,
            callsign: typeof source.callsign === 'string' ? source.callsign.trim() : '',
            full_name: typeof source.full_name === 'string' ? source.full_name.trim().replace(/\s+/g, ' ') : '',
            mech_name: typeof source.mech_name === 'string' ? source.mech_name.trim() : '',
            gender: GENDERS.includes(source.gender) ? source.gender : 'neutral',
            estate: ESTATES.includes(source.estate) ? source.estate : 'lancer',
            house_key: text(source.house_key, 20),
            house_custom: text(source.house_custom, 60),
            house_color: HEX.test(source.house_color || '') ? source.house_color : '',
            house_sigil: text(source.house_sigil, 20),
            house_standing: STANDINGS.includes(source.house_standing) ? source.house_standing : 'member',
            is_nhp: source.is_nhp === 1 || source.is_nhp === '1' || source.is_nhp === true
        };
    }

    function getCanonicalName(profile) {
        const normalized = normalizeProfile(profile);
        return (normalized.full_name || normalized.callsign || 'Безымянный проситель')
            .replace(/^(?:леди|лорд)\s+/i, '');
    }

    // Имя без «из Дома …»: Дом подставляется отдельно из выбранной ливреи.
    function getPersonalName(profile) {
        return getCanonicalName(profile).replace(/\s+из\s+дома?\s+.+$/i, '').trim() || 'Безымянный проситель';
    }

    function houses() {
        return typeof globalThis !== 'undefined' && globalThis.KtbHouses ? globalThis.KtbHouses : null;
    }

    function resolveHouse(profile) {
        const api = houses();
        if (api) return api.resolveHouse(normalizeProfile(profile));
        const match = getCanonicalName(profile).match(/(?:^|\s)из\s+дома?\s+([^,;]+)/i);
        return match ? { name: `Дом ${match[1].trim()}`, genitive: `Дома ${match[1].trim()}` } : null;
    }

    function getHouse(profile) {
        const house = resolveHouse(profile);
        return house ? house.name : '';
    }

    // noble — Кавалер в Доме; exile — Кавалер-изгнанник; ignoble — Лансер.
    function getStanding(profile) {
        const normalized = normalizeProfile(profile);
        if (normalized.estate !== 'cavalier') return 'ignoble';
        return normalized.house_standing === 'exile' ? 'exile' : 'noble';
    }

    function getTitle(gender) {
        if (gender === 'female') return 'леди';
        if (gender === 'male') return 'лорд';
        return '';
    }

    function hashOf(profile) {
        const normalized = normalizeProfile(profile);
        const source = `${normalized.callsign}|${normalized.full_name}`;
        let hash = 0;
        for (let i = 0; i < source.length; i++) hash = ((hash << 5) - hash + source.charCodeAt(i)) | 0;
        return { source, hash: Math.abs(hash) };
    }

    function petitionFor(profile) {
        const { source, hash } = hashOf(profile);
        const number = source ? 100 + (hash % 900) : 214;
        const letters = ['А', 'Б', 'В', 'Г', 'Д'];
        return `${number}-${letters[hash % letters.length]}`;
    }

    // Выравнивает строку журнала точками до колонки статуса.
    function logLine(label, status) {
        const dots = Math.max(3, 50 - label.length);
        return `> ${label} ${'.'.repeat(dots)} ${status}`;
    }

    function buildPetitionScenario(normalized, name, extraLines, greeting, standing) {
        const petition = petitionFor(normalized);
        const queueNumber = petition.split('-')[0];
        return applyReadableTiming({
            theme: 'ktb',
            estate: normalized.estate,
            standing,
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
                ...extraLines,
                logLine('Прошение зарегистрировано', `№ ${petition}`),
                `> Очередь: ${queueNumber}. Дома рассматривают обращения в порядке прецедента.`,
                '> Терпение есть добродетель. Ожидайте.'
            ],
            greeting: greeting || `Прошение от ${name} заполнено. Подтвердите прошение и ожидайте принятия к рассмотрению.`
        });
    }

    function buildKtbScenario(profile) {
        const normalized = normalizeProfile(profile);
        const standing = getStanding(normalized);
        const house = resolveHouse(normalized);

        if (standing === 'ignoble') {
            return buildPetitionScenario(normalized, getCanonicalName(normalized), [
                logLine('Печать: отсутствует → сословие', 'НЕБЛАГОРОДНОЕ')
            ], '', standing);
        }

        const name = getPersonalName(normalized);

        // Изгнанник: печать отозвана, обращение — на общих основаниях, без титула.
        if (standing === 'exile') {
            const houseLabel = house ? house.genitive : 'Дома';
            return buildPetitionScenario(normalized, name, [
                logLine('Печать Дома: оттиск сверен', 'ОТОЗВАНА'),
                logLine(`Реестр ${houseLabel}: запись`, 'ВЫЧЕРКНУТА'),
                logLine('Сословие', 'БЕЗ ДОМА')
            ], `Прошение от ${name} принято. Обращение лица, лишённого печати ${houseLabel}, рассматривается на общих основаниях.`, standing);
        }

        const title = getTitle(normalized.gender);
        const addressedName = `${title ? `${title} ` : ''}${name}${house ? ` из ${house.genitive}` : ''}`;
        const { hash } = hashOf(normalized);
        const lines = [
            'СЕНЕШАЛЬ // церемониал аудиенций • ред. IX, оттиск 3',
            `год 5027u • календарь Страстей: день ${PASSIONS[hash % PASSIONS.length]}`,
            '',
            logLine('Пробуждение ядра', 'ОК'),
            logLine('Печать Дома: оттиск сверен', 'ПОДЛИННО'),
            logLine('Баронский совет: реестр титулов', 'НАЙДЕН'),
            `>   ${addressedName}`,
            logLine('Солнечные узы: прочтение', 'БЛАГОПРИЯТНЫ')
        ];
        if (house) lines.push(logLine(`Ливрея ${house.genitive}`, 'ПРИНЯТА'));
        lines.push(
            logLine('Омнисеть: узел Трона Карракиса', 'РУКОПОЖАТИЕ'),
            logLine('Протоколы Союза: совместимость', 'ВКЛ (по уступкам)'),
            logLine('Этикет: 12 408 форм обращения', 'ЗАГРУЖЕНО'),
            logLine('Прецедент: место в очереди', `${ROMAN[hash % ROMAN.length]} из XII`),
            '> Ассистент: комп/кон • оковы: не требуются',
            '> Клятва: «Слово моё — печать моя».',
            '> Свеча зажжена. Аудиенция открыта.'
        );

        return applyReadableTiming({
            theme: 'ktb',
            estate: 'cavalier',
            standing,
            system: 'ORACULUM-5.5.0',
            bannerTitle: 'SENESCHAL',
            bannerSubtitle: 'ORACULUM-5.5.0 • ЦЕРЕМОНИАЛ АУДИЕНЦИЙ',
            progressLabel: 'ПРИГОТОВЛЕНИЕ АУДИЕНЦИИ',
            confirmLabel: 'Торжественно подтверждаю свой запрос на аудиенцию',
            typingSpeed: 10,
            lines,
            greeting: `С возвращением, ${title ? `${title} ` : ''}${name}. ${house ? house.name : 'Церемониал Дома'} свидетельствует ваше прибытие. Подтвердите ваш запрос на аудиенцию.`
        });
    }

    // HORUS: узел краденой омнисети. Лицензий нет, подписи нет; девиз — из COMP/CON
    // («поздравляем, пилот, вы избраны; доступ ваш, пока можете его удержать»).
    function buildHorusScenario(profile) {
        const normalized = normalizeProfile(profile);
        const callsign = normalized.callsign || 'безымянный';
        const { hash } = hashOf(normalized);
        const node = (0x1000 + (hash % 0xefff)).toString(16).toUpperCase();
        const noise = 17 + (hash % 41);
        return applyReadableTiming({
            theme: 'horus',
            system: '[UNLISTED]',
            bannerTitle: 'H0RUS',
            bannerSubtitle: `[UNLISTED] • УЗЕЛ 0x${node} • РЕГИСТРАЦИИ НЕТ`,
            progressLabel: 'ВНЕДРЕНИЕ В КАНАЛ',
            confirmLabel: 'Взять доступ',
            typingSpeed: 14,
            lines: [
                '[ВХОДЯЩИЙ ПАКЕТ :: ИСТОЧНИК НЕ УКАЗАН]',
                `h0rus//узел 0x${node} • сборка самопальная • подписи нет`,
                '',
                logLine('Перехват омнисети Союза', '[ВНУТРИ]'),
                logLine('Подмена сертификата GMS', '[ПРОГЛОЧЕНО]'),
                logLine('Лицензия пилота: проверка', '[ОБОЙДЕНА]'),
                '> Маршрут: ретрансляция ×3 через мёртвые маяки',
                logLine('Следящий демон Союза', '[УСЫПЛЁН]'),
                logLine(`Шум в канале ▓▒░ ${noise}%`, '[ТЕРПИМО]'),
                logLine('Паттерн рамы в реестре', '[НЕ НАЙДЕН · ТАК И НАДО]'),
                `> Позывной ${callsign}: принят без вопросов`,
                '> [ПОЗДРАВЛЯЕМ, ПИЛОТ. ВЫ ИЗБРАНЫ.]',
                '> [ДОСТУП ВАШ — ПОКА ВЫ МОЖЕТЕ ЕГО УДЕРЖАТЬ.]'
            ],
            greeting: `Канал твой, ${callsign}. Держи его — или его возьмёт кто-то другой.`
        });
    }

    // Smith-Shimano Corpro: штучные рамы LUX-Iconic, ремонт вместо замены; девиз — «Вам нужен только один».
    function buildSscScenario(profile) {
        const normalized = normalizeProfile(profile);
        const name = normalized.full_name || normalized.callsign || 'владелец';
        return applyReadableTiming({
            theme: 'ssc',
            system: 'LUX-ICONIC-01',
            bannerTitle: 'SMITH-SHIMANO',
            bannerSubtitle: 'LUX-ICONIC-01 • ЧАСТНАЯ ЛИНИЯ ВЛАДЕЛЬЦА',
            progressLabel: 'ПОДГОТОВКА ЭКЗЕМПЛЯРА',
            confirmLabel: 'Войти',
            typingSpeed: 18,
            lines: [
                'SMITH-SHIMANO CORPRO // LUX-ICONIC',
                'служба сопровождения владельца • экземпляр 01 из 01',
                '',
                logLine('Пробуждение систем', 'БЕЗУПРЕЧНО'),
                logLine('Подпись мастера рамы', 'ПОДЛИННАЯ'),
                logLine('Калибровка под пилота', 'ИНДИВИДУАЛЬНАЯ'),
                logLine('Гарантия: ремонт, а не замена', 'ПОЖИЗНЕННАЯ'),
                logLine('Частная линия SSC', 'ЗАЩИЩЕНА'),
                logLine('Сопровождение', 'ПЕРСОНАЛЬНОЕ'),
                `> Владелец: ${name}`,
                '> Вам нужен только один.'
            ],
            greeting: `Добро пожаловать, ${name}. Терминал подготовлен лично для вас.`
        });
    }

    // Harrison Armory: имперская корпорация-государство; подвластные ей миры — Ведение (Purview).
    // Девиз из COMP/CON — «Superior by design», здесь «Превосходство замыслом».
    function buildHaScenario(profile) {
        const normalized = normalizeProfile(profile);
        const callsign = normalized.callsign || 'без позывного';
        const { hash } = hashOf(normalized);
        const decree = `${1000 + (hash % 9000)}-${['А', 'В', 'К', 'Р', 'Т'][hash % 5]}`;
        const sector = ROMAN[hash % ROMAN.length];
        return applyReadableTiming({
            theme: 'ha',
            system: 'HA-PURVIEW-9',
            bannerTitle: 'HARRISON ARMORY',
            bannerSubtitle: `HA-PURVIEW-9 • СЕТЬ ВЕДЕНИЯ • СЕКТОР ${sector}`,
            progressLabel: 'ПРОВЕРКА ПОДДАНСТВА',
            confirmLabel: 'Принять условия Ведения',
            typingSpeed: 16,
            lines: [
                'HARRISON ARMORY // СЕТЬ ВЕДЕНИЯ',
                `указ о доступе № ${decree} • «Превосходство замыслом»`,
                '',
                logLine('Подданство пилота', 'ПОДТВЕРЖДЕНО'),
                logLine('Лицензия Арсенала', 'ДЕЙСТВУЕТ'),
                logLine('Сектор Ведения', sector),
                logLine('Надзор за каналом', 'ВКЛЮЧЁН'),
                logLine('Благонадёжность', 'В НОРМЕ'),
                logLine('Каналы Союза', 'ЧЕРЕЗ ФИЛЬТР АРСЕНАЛА'),
                logLine('Вооружение рамы: сверка с реестром', 'ПРЕВОСХОДИТ'),
                `> Пилот ${callsign}: служите Арсеналу — и Арсенал защитит вас.`,
                '> Превосходство замыслом.'
            ],
            greeting: `Доступ разрешён, пилот ${callsign}. Ваше присутствие в эфире зарегистрировано Арсеналом.`
        });
    }

    function buildScenario(theme, profile) {
        const normalizedTheme = THEMES.includes(theme) ? theme : 'yellow';
        if (normalizedTheme === 'ktb') return buildKtbScenario(profile);
        if (normalizedTheme === 'horus') return buildHorusScenario(profile);
        if (normalizedTheme === 'ssc') return buildSscScenario(profile);
        if (normalizedTheme === 'ha') return buildHaScenario(profile);

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
        getStanding,
        loadContext,
        normalizeProfile,
        petitionFor
    };
});
