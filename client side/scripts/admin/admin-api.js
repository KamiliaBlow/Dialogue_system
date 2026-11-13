// Единый API-клиент админки: панель (admin.html) и студия (studio.html).
// Все запросы — с cookie сессии и без кэша; ошибка сервера превращается в ApiError
// с текстом из ответа ({ message }), чтобы показать его пользователю как есть.
import AppConfig from '../config.js';

const { API_URL, CACHE_HEADERS } = AppConfig;

export class ApiError extends Error {
    constructor(message, status, data) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.data = data;
    }
}

async function request(path, { method = 'GET', body, form } = {}) {
    const options = { method, credentials: 'include', headers: { ...CACHE_HEADERS } };
    if (form) {
        options.body = form;
    } else if (body !== undefined) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    let response;
    try {
        response = await fetch(`${API_URL}${path}`, options);
    } catch (error) {
        throw new ApiError('Нет связи с сервером', 0, null);
    }

    const text = await response.text().catch(() => '');
    let data = null;
    if (text) {
        try { data = JSON.parse(text); } catch { data = { message: text }; }
    }
    if (!response.ok) {
        throw new ApiError(data?.message || data?.error || `Ошибка сервера: ${response.status}`, response.status, data);
    }
    return data ?? {};
}

const get = path => request(path);
const post = (path, body) => request(path, { method: 'POST', body });
const put = (path, body) => request(path, { method: 'PUT', body });
const del = path => request(path, { method: 'DELETE' });
const upload = (path, form, method = 'POST') => request(path, { method, form });
const enc = encodeURIComponent;

const api = {
    request, get, post, put, del, upload,

    // ---- доступ ----
    checkAuth: () => get('/admin/check'),
    logout: () => post('/logout'),

    // ---- игроки ----
    getUsers: () => get('/admin/users'),
    changePassword: (userId, newPassword) => post('/admin/change-password', { userId, newPassword }),
    deleteUser: userId => del(`/admin/delete-user/${enc(userId)}`),
    clearProgress: (userId, frequency) => post('/admin/clear-progress', { userId, frequency }),
    getUserPilots: userId => get(`/editor/users/${enc(userId)}/pilots`),
    renameUser: (userId, username) => post('/admin/rename-user', { userId, username }),
    // Пилоты игрока со всеми полями досье; правка и назначение активным — от имени админа.
    pilots: {
        list: userId => get(`/admin/users/${enc(userId)}/pilots`),
        update: (userId, slot, data) => put(`/admin/users/${enc(userId)}/pilots/${enc(slot)}`, data),
        activate: (userId, slot) => post(`/admin/users/${enc(userId)}/pilots/${enc(slot)}/activate`)
    },

    // ---- статистика ----
    getFrequencies: () => get('/admin/frequencies'),
    getChoiceStatistics: () => get('/admin/choice-statistics'),
    getDialoguesCount: () => get('/admin/dialogues-count'),
    getChoiceDetails: (frequency, choiceId) => get(`/admin/choice-details/${enc(frequency)}/${enc(choiceId)}`),
    getUserProgress: () => get('/admin/user-progress'),

    // ---- музыка ----
    music: {
        list: () => get('/admin/music'),
        update: (id, data) => put(`/admin/music/${enc(id)}`, data),
        remove: id => del(`/admin/music/${enc(id)}`),
        upload: form => upload('/admin/music/upload', form)
    },

    // ---- отношения игроков с персонажами каталога ----
    relations: {
        all: () => get('/editor/global-characters/relations'),
        forCharacter: characterId => get(`/editor/global-characters/${enc(characterId)}/relations`),
        // global: true — стартовое значение для всех пилотов аккаунта; pilotProfileId — для одного пилота.
        set: (characterId, userId, payload) => put(`/editor/global-characters/${enc(characterId)}/user/${enc(userId)}/relation`, payload),
        init: () => post('/editor/global-characters/init-relations')
    },

    // ---- каталог персонажей ----
    characters: {
        list: () => get('/editor/global-characters'),
        create: form => upload('/editor/global-characters', form),
        update: (id, form) => upload(`/editor/global-characters/${enc(id)}`, form, 'PUT'),
        remove: id => del(`/editor/global-characters/${enc(id)}`)
    },

    // ---- диалоги ----
    dialogues: {
        list: () => get('/editor/dialogues'),
        get: id => get(`/editor/dialogues/${enc(id)}`),
        create: data => post('/editor/dialogues', data),
        update: (id, data) => put(`/editor/dialogues/${enc(id)}`, data),
        remove: id => del(`/editor/dialogues/${enc(id)}`),
        users: () => get('/editor/users'),
        // Перемычки линии связи в дереве; пустой список — убрать.
        saveEdgePoints: (id, edgeKey, points) => put(`/editor/dialogues/${enc(id)}/edge-points`, { edgeKey, points })
    },
    dialogueCharacters: {
        create: data => post('/editor/characters', data),
        update: (id, data) => put(`/editor/characters/${enc(id)}`, data),
        remove: id => del(`/editor/characters/${enc(id)}`)
    },
    conversations: {
        create: data => post('/editor/conversations', data),
        update: (id, data) => put(`/editor/conversations/${enc(id)}`, data),
        remove: id => del(`/editor/conversations/${enc(id)}`),
        shift: data => post('/editor/conversations/shift', data),
        link: data => post('/editor/conversations/link', data),
        unlink: data => post('/editor/conversations/unlink', data),
        // Ножницы: type sequential (from/to реплики) или choice (choiceOptionId).
        cut: data => post('/editor/conversations/cut', data),
        // Вариант реплики для сословия: audience — cavalier | lancer.
        saveVariant: (id, audience, data) => put(`/editor/conversations/${enc(id)}/variants/${enc(audience)}`, data),
        removeVariant: (id, audience) => del(`/editor/conversations/${enc(id)}/variants/${enc(audience)}`)
    },
    branches: {
        create: data => post('/editor/branches', data),
        createWithConversation: data => post('/editor/branches/with-conversation', data),
        remove: (dialogueId, branchId) => del(`/editor/branches/${enc(dialogueId)}/${enc(branchId)}`)
    },
    choices: {
        create: data => post('/editor/choices', data),
        update: (id, data) => put(`/editor/choices/${enc(id)}`, data),
        remove: id => del(`/editor/choices/${enc(id)}`)
    },

    // ---- медиафайлы ----
    files: {
        list: kind => get(`/editor/files/${enc(kind)}`),            // portraits | sounds | voicelines
        upload: (kind, file) => {                                     // portrait | sound | voiceline
            const form = new FormData();
            form.append(kind, file);
            return upload(`/editor/files/upload-${kind}`, form);
        }
    }
};

export default api;
