// Реплики, обращённые к пилоту: метки в тексте и вариант реплики для сословия.
//
// Метки (регистр важен, неизвестная метка остаётся как есть — так опечатку видно):
//   <Name>     — позывной пилота                      RAVEN
//   <FullName> — каноническое имя без титула и Дома    Кассия-Вейл
//   <Title>    — «леди» / «лорд» у Кавалера в Доме, иначе пусто
//   <House>    — Дом в родительном падеже              Дома Стекла
// Пустая метка забирает за собой один пробел: «<Title> <Name>» у Лансера даёт «HAMMER».
//
// Вариант реплики: у реплики может быть замена для аудитории 'cavalier' или 'lancer'.
// Кавалер в Доме — аудитория 'cavalier'; Лансер и Кавалер-изгнанник — 'lancer'
// (так же, как в теме КТБ: изгнанник видит интерфейс неблагородных).
// Используется терминалом (dialogue.js) и превью студии.

export const TOKENS = Object.freeze(['Name', 'FullName', 'Title', 'House']);
export const AUDIENCES = Object.freeze(['cavalier', 'lancer']);
export const AUDIENCE_LABELS = Object.freeze({ cavalier: 'Кавалер', lancer: 'Лансер' });

const TOKEN_RE = /<(Name|FullName|Title|House)>( ?)/g;
const TOKEN_TEST = /<(?:Name|FullName|Title|House)>/;

function clean(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function audienceOf(profile) {
    const p = profile || {};
    return p.estate === 'cavalier' && p.house_standing !== 'exile' ? 'cavalier' : 'lancer';
}

function houseGenitive(profile) {
    const p = profile || {};
    if (p.estate !== 'cavalier') return '';
    const houses = typeof globalThis !== 'undefined' ? globalThis.KtbHouses : null;
    const resolved = houses?.resolveHouse?.(p);
    if (resolved?.genitive) return resolved.genitive;
    const match = clean(p.full_name).match(/\sиз\s+(Дома?\s+.+)$/i);
    return match ? match[1].replace(/^дом\b/i, 'Дома').replace(/^Дом\s/, 'Дома ') : '';
}

// Значения меток для пилота.
export function tokenValues(profile) {
    const p = profile || {};
    const callsign = clean(p.callsign);
    const personal = clean(p.full_name)
        .replace(/^(?:леди|лорд)\s+/i, '')
        .replace(/\s+из\s+дома?\s+.+$/i, '')
        .trim();
    const isNobleCavalier = audienceOf(p) === 'cavalier';
    const title = isNobleCavalier ? ({ female: 'леди', male: 'лорд' }[p.gender] || '') : '';
    return {
        Name: callsign,
        FullName: personal || callsign,
        Title: title,
        House: houseGenitive(p)
    };
}

export function hasTokens(text) {
    return typeof text === 'string' && TOKEN_TEST.test(text);
}

export function applyTokens(text, values) {
    if (typeof text !== 'string' || !text) return text;
    return text.replace(TOKEN_RE, (match, token, space) => {
        const value = values[token];
        if (value === undefined) return match;
        return value ? value + space : '';
    });
}

// Реплика для конкретной аудитории: поля варианта заменяют основные.
// Текст, озвучка и скорость печати — всегда от варианта (своя запись под свою фразу);
// поддельное имя и портрет — от варианта, если заданы, иначе основные.
export function resolveVariant(conversation, audience) {
    const variant = conversation?.variants?.[audience];
    if (!variant || !variant.text) return conversation;
    const resolved = { ...conversation, text: variant.text, variantAudience: audience };
    if (variant.voiceline) resolved.voiceline = variant.voiceline;
    else delete resolved.voiceline;
    if (variant.typingSpeed > 0) resolved.typingSpeed = variant.typingSpeed;
    else delete resolved.typingSpeed;
    if (variant.fakeName) resolved.fakeName = variant.fakeName;
    if (variant.image) resolved.image = variant.image;
    return resolved;
}

// Реплика, какой её увидит пилот: вариант по сословию + метки в тексте, имени и вариантах ответа.
// Исходный текст варианта ответа сохраняется в rawText — он уходит в статистику выборов.
export function prepareConversation(conversation, profile) {
    if (!conversation || typeof conversation !== 'object') return conversation;
    const values = tokenValues(profile);
    const resolved = resolveVariant(conversation, audienceOf(profile));
    const out = { ...resolved, text: applyTokens(resolved.text, values) };
    if (out.fakeName) out.fakeName = applyTokens(out.fakeName, values);
    if (out.choice?.options) {
        out.choice = {
            ...out.choice,
            options: out.choice.options.map(opt => ({
                ...opt,
                rawText: opt.rawText ?? opt.text,
                text: applyTokens(opt.text, values)
            }))
        };
    }
    delete out.variants;
    return out;
}

// Весь диалог: главная ветка (conversations) и ветки выборов ({ responses: [...] }).
export function prepareDialogue(dialogue, profile) {
    if (!dialogue || typeof dialogue !== 'object') return dialogue;
    const out = { ...dialogue };
    if (Array.isArray(out.conversations)) {
        out.conversations = out.conversations.map(c => prepareConversation(c, profile));
    }
    Object.keys(out).forEach(key => {
        const branch = out[key];
        if (key !== 'conversations' && branch && Array.isArray(branch.responses)) {
            out[key] = { ...branch, responses: branch.responses.map(c => prepareConversation(c, profile)) };
        }
    });
    return out;
}
