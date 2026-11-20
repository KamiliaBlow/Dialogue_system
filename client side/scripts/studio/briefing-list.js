// Студия → «Брифинги»: список брифингов, доступ и публикация, кто прослушал, экспорт и импорт.
// Сам брифинг (карта, объекты, реплики, звук) правится в 3D-редакторе: briefing/editor.html?id=<id>.
// Сценарий хранится на сервере JSON-документом (server side/routes/briefings.js).
import api from '../admin/admin-api.js';
import { toast, withBusy } from '../admin/admin-shell.js';
import { escapeHtml, escapeAttr } from '../escape-utils.js';
import store, { assetUrl } from './studio-store.js';

const $ = id => document.getElementById(id);
const fmtDate = s => { if (!s) return '—'; const d = new Date(s.replace(' ', 'T') + (s.includes('Z') ? '' : 'Z'));
    return isNaN(d) ? s : d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }); };
const allowedOf = b => { try { return JSON.parse(b.allowed_users || '[-1]'); } catch { return [-1]; } };

// Шаблон нового брифинга: пустой — минимальный сценарий (остальное дополнит редактор), демо — из ядра модуля.
let coreReady = null;
function loadCore() {
    if (!coreReady) coreReady = (async () => {
        const THREE = await import('../../briefing/vendor/three/build/three.module.js');
        if (!window.BriefingCore) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'briefing/core.js'; s.onload = res; s.onerror = () => rej(new Error('Не удалось загрузить модуль брифинга')); document.head.append(s); });
        return window.BriefingCore(THREE);
    })();
    return coreReady;
}
const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
// Ссылки на файлы звука в сценарии; kind — для лимита размера при загрузке (голос, звук, музыка).
function audioRefs(sc) {
    const refs = [];
    (sc.steps || []).forEach(st => st.voice && st.voice.id && refs.push({ ref:st.voice, kind:'voice' }));
    const snd = sc.sound || {};
    Object.values(snd.sfx || {}).forEach(s => s && s.mode === 'file' && s.id && refs.push({ ref:s, kind:'sfx' }));
    Object.values(snd.music || {}).forEach(m => m && m.id && refs.push({ ref:m, kind:'music' }));
    return refs;
}

export default class BriefingList {
    constructor(studio) {
        this.studio = studio;
        this.items = [];
        this.current = null;          // строка брифинга с сервера
        this.allowed = [];
    }

    get currentId() { return this.current ? this.current.id : null; }

    async init() {
        $('bf-new-btn').addEventListener('click', () => this.newMenu());
        $('bf-access').addEventListener('change', () => { $('bf-users').classList.toggle('hidden', $('bf-access').value === 'all'); this.renderSummary(); });
        $('bf-active').addEventListener('change', () => this.renderSummary());
        $('bf-save-btn').addEventListener('click', () => this.saveMeta());
        $('bf-delete-btn').addEventListener('click', () => this.remove());
        $('bf-open-btn').addEventListener('click', () => { if (this.current) open(`briefing/editor.html?id=${this.current.id}`, '_blank'); });   // отдельная вкладка: 3D-редактор во весь экран, студия остаётся открытой
        $('bf-preview-btn').addEventListener('click', () => { if (this.current) open(`briefing/player.html?id=${this.current.id}&studio=1`, '_blank'); });
        $('bf-dup-btn').addEventListener('click', () => this.duplicate());
        $('bf-export-btn').addEventListener('click', () => this.exportJson());
        $('bf-reset-all-btn').addEventListener('click', () => this.resetListeners());
        $('bf-import-file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) this.importJson(f); });
        await this.load();
    }

    async load() {
        try { this.items = (await api.get('/editor/briefings')).briefings || []; }
        catch (e) { toast(e.message, 'error'); this.items = []; }
        this.renderList();
    }

    renderList() {
        const box = $('bf-list');
        if (!this.items.length) { box.innerHTML = '<div class="empty-list">Брифингов пока нет. «+ Новый» — создать.</div>'; return; }
        box.innerHTML = this.items.map(b => `
            <button type="button" class="dialogue-item ${b.is_active ? '' : 'dialogue-inactive'} ${this.currentId === b.id ? 'active' : ''}" data-id="${escapeAttr(b.id)}">
                <span class="dialogue-item-frequency">${escapeHtml(b.code || '—')}</span>
                <span class="dialogue-item-title">${escapeHtml(b.title || 'Без названия')}</span>
            </button>`).join('');
        box.querySelectorAll('.dialogue-item').forEach(el => el.addEventListener('click', () => this.select(Number(el.dataset.id))));
    }

    async select(id) {
        const b = this.items.find(x => x.id === Number(id));
        this.current = b || null;
        $('bf-placeholder').classList.toggle('hidden', !!b);
        $('bf-content').classList.toggle('hidden', !b);
        this.renderList();
        this.studio.updateHash();
        if (!b) return;
        $('bf-title').textContent = b.title || 'Без названия';
        $('bf-meta').textContent = [b.code && `Контракт ${b.code}`, b.client, `изменён ${fmtDate(b.updated_at)}`, `версия ${b.version}`].filter(Boolean).join(' · ');
        const allowed = allowedOf(b), all = allowed.includes(-1);
        $('bf-access').value = all ? 'all' : 'custom';
        this.allowed = all ? [] : allowed;
        $('bf-active').checked = !!b.is_active;
        $('bf-order').value = b.sort_order;
        this.renderUsers();
        $('bf-users').classList.toggle('hidden', all);
        this.renderSummary();
        this.loadListeners();
    }

    renderUsers() {
        const box = $('bf-users-list');
        box.innerHTML = store.users.map(u => `
            <div class="user-item">
                <input type="checkbox" id="bf-user-${escapeAttr(u.id)}" value="${escapeAttr(u.id)}" ${this.allowed.includes(u.id) ? 'checked' : ''}>
                <label for="bf-user-${escapeAttr(u.id)}">${escapeHtml(u.username)} (ID: ${escapeHtml(u.id)})</label>
            </div>`).join('');
        box.querySelectorAll('input').forEach(cb => cb.addEventListener('change', () => {
            const id = Number(cb.value); this.allowed = this.allowed.filter(x => x !== id); if (cb.checked) this.allowed.push(id); this.renderSummary(); }));
    }

    renderSummary() {
        const all = $('bf-access').value === 'all', on = $('bf-active').checked;
        $('bf-summary').innerHTML = [
            [on ? 'опубликован' : 'черновик', on ? 'chip-on' : 'chip-off'],
            [all ? 'доступ всем' : `доступ: ${this.allowed.length} игр.`, '']
        ].map(([t, c]) => `<span class="info-chip ${c}">${escapeHtml(t)}</span>`).join('');
    }

    async saveMeta() {
        if (!this.current) return;
        const all = $('bf-access').value === 'all';
        if (!all && !this.allowed.length) { toast('Выберите хотя бы одного игрока или откройте доступ всем', 'error'); return; }
        await withBusy($('bf-save-btn'), async () => {
            try {
                const r = await api.patch(`/editor/briefings/${this.current.id}`, {
                    allowed_users:all ? [-1] : this.allowed, is_active:$('bf-active').checked, sort_order:Number($('bf-order').value) || 0 });
                Object.assign(this.current, r.briefing); toast('Сохранено', 'success');
                this.items.sort((a, b) => a.sort_order - b.sort_order || a.id - b.id); this.renderList();
            } catch (e) { toast(e.message, 'error'); }
        });
    }

    async loadListeners() {
        const body = $('bf-listeners-tbody'), id = this.currentId;
        body.innerHTML = '<tr><td colspan="4" class="muted">Загрузка…</td></tr>';
        try {
            const list = (await api.get(`/editor/briefings/${id}/listeners`)).listeners || [];
            if (id !== this.currentId) return;
            $('bf-reset-all-btn').disabled = !list.length;
            body.innerHTML = list.length ? list.map(l => `
                <tr><td>${escapeHtml(l.username)}</td><td>${escapeHtml(l.times)}</td><td>${escapeHtml(fmtDate(l.last_listened))}</td>
                <td><button class="btn btn-small" data-user="${escapeAttr(l.user_id)}" title="Запись снова станет для игрока новой">Сбросить</button></td></tr>`).join('')
                : '<tr><td colspan="4" class="muted">Пока никто не дослушал брифинг до конца.</td></tr>';
            body.querySelectorAll('[data-user]').forEach(b => b.addEventListener('click', () => this.resetListeners(Number(b.dataset.user))));
        } catch (e) { body.innerHTML = `<tr><td colspan="4" class="muted">${escapeHtml(e.message)}</td></tr>`; }
    }

    async resetListeners(userId) {
        if (!this.current) return;
        if (!userId && !confirm('Сбросить отметки у всех игроков? Брифинг снова станет для них новым.')) return;
        try { await api.del(`/editor/briefings/${this.current.id}/listeners${userId ? `?user=${userId}` : ''}`); toast('Отметка сброшена', 'success'); this.loadListeners(); }
        catch (e) { toast(e.message, 'error'); }
    }

    // ---------- создание, копия, удаление ----------
    newMenu() {
        const menu = $('bf-new-menu');
        menu.classList.toggle('hidden');
        if (menu.dataset.bound) return; menu.dataset.bound = '1';
        menu.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', async () => {
            menu.classList.add('hidden');
            if (b.dataset.new === 'import') { $('bf-import-file').click(); return; }
            try {
                const Core = await loadCore();
                const sc = b.dataset.new === 'demo' ? Core.defaultScenario() : Core.blankScenario();
                const hf = new Core.Heightfield(); Core.terrainFrom(sc, hf); sc.terrain.data = hf.encode();   // карта высот — как её видел бы редактор
                await this.create(sc);
            } catch (e) { toast(e.message, 'error'); }
        }));
    }

    async create(sc) {
        const r = await api.post('/editor/briefings', { scenario:sc });
        toast('Брифинг создан — пока это черновик, игроки его не видят', 'success');
        await this.load(); this.select(r.briefing.id);
    }

    async duplicate() {
        if (!this.current) return;
        try { const r = await api.post(`/editor/briefings/${this.current.id}/duplicate`); toast('Копия создана', 'success'); await this.load(); this.select(r.briefing.id); }
        catch (e) { toast(e.message, 'error'); }
    }

    async remove() {
        if (!this.current) return;
        if (!confirm(`Удалить брифинг «${this.current.title || 'Без названия'}»? Это нельзя отменить. Файлы звука останутся на сервере.`)) return;
        try { await api.del(`/editor/briefings/${this.current.id}`); toast('Брифинг удалён', 'success'); this.current = null; await this.load(); this.select(null); }
        catch (e) { toast(e.message, 'error'); }
    }

    // ---------- экспорт и импорт: один JSON-файл, звук вшит (тот же формат, что у офлайн-редактора) ----------
    async exportJson() {
        if (!this.current) return;
        await withBusy($('bf-export-btn'), async () => {
            try {
                const { scenario:sc } = await api.get(`/editor/briefings/${this.current.id}`), audio = {};
                for (const { ref } of audioRefs(sc)) if (!audio[ref.id]) {
                    try { const r = await fetch(assetUrl(ref.id)); if (r.ok) audio[ref.id] = await blobToDataURL(await r.blob()); } catch (e) { console.warn('Файл не выгружен', ref.id, e); }
                }
                if (Object.keys(audio).length) sc.assets = { audio };
                const a = document.createElement('a');
                a.href = URL.createObjectURL(new Blob([JSON.stringify(sc, null, 1)], { type:'application/json' }));
                a.download = `briefing_${(this.current.code || this.current.id).toString().replace(/[^\wа-яё-]+/gi, '_')}.json`;
                document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
            } catch (e) { toast(e.message, 'error'); }
        });
    }

    async importJson(file) {
        try {
            const sc = JSON.parse(await file.text());
            if (!sc || !Array.isArray(sc.objects) || !Array.isArray(sc.steps)) throw new Error('Это не файл брифинга (нет objects/steps)');
            const embedded = (sc.assets && sc.assets.audio) || {}, map = {}, ids = Object.keys(embedded);
            const kindOf = {}; audioRefs(sc).forEach(({ ref, kind }) => { kindOf[ref.id] = kind; });
            for (const [i, id] of ids.entries()) {
                toast(`Загружаю звук: ${i + 1} / ${ids.length}`);
                const blob = await (await fetch(embedded[id])).blob();
                const ext = (blob.type.match(/(mpeg|mp3|ogg|wav)/) || ['', 'mp3'])[1].replace('mpeg', 'mp3');
                const form = new FormData(); form.append('file', new File([blob], `${id.split('/').pop().replace(/\.\w+$/, '')}.${ext}`, { type:blob.type || 'audio/mpeg' }));
                map[id] = (await api.upload(`/editor/briefings/upload-audio?kind=${kindOf[id] || 'sfx'}`, form)).path;
            }
            delete sc.assets;
            for (const { ref } of audioRefs(sc)) if (map[ref.id]) ref.id = map[ref.id];
            await this.create(sc);
        } catch (e) { toast('Импорт не удался: ' + e.message, 'error'); }
    }
}
