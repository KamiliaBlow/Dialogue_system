// Общие данные студии: каталог персонажей, медиафайлы, пользователи.
// Загружаются один раз и разделяются между разделами «Диалоги» и «Персонажи»;
// после изменения раздел сообщает об этом через emit(), остальные перерисовываются.
import AppConfig from '../config.js';
import api from '../admin/admin-api.js';

const { ASSETS_URL } = AppConfig;

// Путь из БД (/assets/... или assets/...) → адрес на сервере ассетов.
export function assetUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//.test(path)) return path;
    if (ASSETS_URL && !ASSETS_URL.includes('DOMENHERE')) {
        if (path.startsWith('/assets/')) return ASSETS_URL.replace(/\/assets$/, '') + path;
        if (path.startsWith('assets/')) return `${ASSETS_URL}/${path.slice('assets/'.length)}`;
    }
    return path;
}

export function fileName(path) {
    return String(path || '').split('/').pop();
}

const listeners = new Map();

const store = {
    globalCharacters: [],
    users: [],
    files: { portraits: [], sounds: [], voicelines: [] },

    on(event, fn) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(fn);
    },

    emit(event, payload) {
        (listeners.get(event) || []).forEach(fn => {
            try { fn(payload); } catch (e) { console.error(`store listener ${event}:`, e); }
        });
    },

    async loadCharacters() {
        const data = await api.characters.list();
        this.globalCharacters = data.characters || [];
        this.emit('characters', this.globalCharacters);
        return this.globalCharacters;
    },

    async loadUsers() {
        try {
            const data = await api.dialogues.users();
            this.users = data.users || [];
        } catch (error) {
            console.error('Error loading users:', error);
            this.users = [];
        }
        return this.users;
    },

    // kind: portraits | sounds | voicelines; без аргумента — все три списка.
    async loadFiles(kind) {
        const kinds = kind ? [kind] : ['portraits', 'sounds', 'voicelines'];
        await Promise.all(kinds.map(async k => {
            try {
                const data = await api.files.list(k);
                this.files[k] = data.files || [];
            } catch (error) {
                console.error(`Error loading ${k}:`, error);
            }
        }));
        this.emit('files', this.files);
        return this.files;
    },

    // Загрузка файла: kind — portrait | sound | voiceline. Возвращает { path, filename }.
    async uploadFile(kind, file) {
        const data = await api.files.upload(kind, file);
        await this.loadFiles(`${kind}s`);
        return data;
    },

    characterById(id) {
        return this.globalCharacters.find(c => String(c.id) === String(id)) || null;
    }
};

export default store;
