// Раздел студии «Персонажи»: каталог (global_characters).
// Слева — список, в центре — карточка и отношения с игроками, справа — портрет как в терминале.
import api from '../admin/admin-api.js';
import { toast, withBusy } from '../admin/admin-shell.js';
import { relationColor, formatRelation } from '../relation-colors.js';
import { escapeHtml, escapeAttr } from '../escape-utils.js';
import { readPortrait, portraitCss, BASE_FRAME } from '../portrait-frame.js';
import store, { assetUrl, fileName } from './studio-store.js';
import PortraitEditor from './portrait-editor.js';

const THUMB_WIDTH = 34;

export default class CharacterCatalog {
    constructor(studio) {
        this.studio = studio;
        this.editingId = null;     // null — новый персонаж
        this.open = false;
        this.dirty = false;
        this.relPilotMap = {};
        this.el = id => document.getElementById(id);
    }

    init() {
        this.portrait = new PortraitEditor({ onChange: () => this.markDirty() });
        this.bindEvents();
        this.fillPortraitSelect();
        this.renderList();
        store.on('characters', () => this.renderList());
        store.on('files', () => this.fillPortraitSelect());
    }

    bindEvents() {
        this.el('gc-new-btn').addEventListener('click', () => this.openCharacter(null));
        this.el('gc-search').addEventListener('input', () => this.renderList());
        this.el('gc-save-btn').addEventListener('click', e => withBusy(e.currentTarget, () => this.save()));
        this.el('gc-delete-btn').addEventListener('click', () => this.remove());
        this.el('gc-init-relations-btn').addEventListener('click', e => withBusy(e.currentTarget, () => this.initRelations()));

        this.el('gc-name').addEventListener('input', () => {
            this.portrait.setName(this.el('gc-name').value.trim());
            this.markDirty();
        });
        const relationInput = this.el('gc-default-relation');
        relationInput.addEventListener('input', () => {
            relationInput.style.setProperty('--rel-color', relationColor(parseInt(relationInput.value) || 0));
            this.markDirty();
        });
        this.el('gc-portrait-select').addEventListener('change', e => {
            this.portrait.setImage(e.target.value);
            this.markDirty();
        });
        this.el('gc-upload-portrait-btn').addEventListener('click', () => this.el('gc-upload-portrait').click());
        this.el('gc-upload-portrait').addEventListener('change', e => this.uploadPortrait(e));

        window.addEventListener('beforeunload', e => {
            if (this.dirty) { e.preventDefault(); e.returnValue = ''; }
        });
    }

    // ---------- список ----------

    renderList() {
        const list = this.el('gc-list');
        const term = this.el('gc-search').value.trim().toLowerCase();
        const items = store.globalCharacters.filter(c => !term || c.name.toLowerCase().includes(term));

        if (store.globalCharacters.length === 0) {
            list.innerHTML = '<div class="no-data">Нет персонажей. Нажмите «+ Новый».</div>';
            return;
        }
        if (items.length === 0) {
            list.innerHTML = '<div class="no-data">Никого не нашлось</div>';
            return;
        }

        list.textContent = '';
        items.forEach(c => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = `dialogue-item gc-item${String(c.id) === String(this.editingId) && this.open ? ' active' : ''}`;
            item.dataset.id = c.id;

            const thumb = document.createElement('span');
            thumb.className = 'gc-thumb';
            thumb.setAttribute('aria-hidden', 'true');
            if (c.image) {
                // Миниатюра по той же формуле, что и терминал, в рамке шириной THUMB_WIDTH.
                const css = portraitCss(readPortrait(c), THUMB_WIDTH);
                thumb.style.backgroundImage = `url("${assetUrl(c.image)}")`;
                thumb.style.backgroundSize = css.backgroundSize;
                thumb.style.backgroundPosition = css.backgroundPosition;
                thumb.style.transform = css.transform;
            }

            const text = document.createElement('span');
            text.className = 'gc-item-text';
            const name = document.createElement('span');
            name.className = 'dialogue-item-title';
            name.textContent = c.name;
            const rel = document.createElement('span');
            rel.className = 'gc-item-relation';
            rel.style.color = relationColor(c.default_relation);
            rel.textContent = `отношение ${formatRelation(c.default_relation)}`;
            text.append(name, rel);

            item.append(thumb, text);
            item.addEventListener('click', () => this.openCharacter(c.id));
            list.appendChild(item);
        });
    }

    fillPortraitSelect() {
        const select = this.el('gc-portrait-select');
        const current = select.value;
        select.textContent = '';
        select.add(new Option('Без портрета', ''));
        store.files.portraits.forEach(p => select.add(new Option(fileName(p), p)));
        if ([...select.options].some(o => o.value === current)) select.value = current;
    }

    // ---------- карточка ----------

    markDirty() {
        this.dirty = true;
        this.el('gc-dirty').hidden = false;
    }

    markSaved() {
        this.dirty = false;
        this.el('gc-dirty').hidden = true;
    }

    confirmDiscard() {
        return !this.dirty || confirm('Изменения персонажа не сохранены. Отменить их?');
    }

    // id = null — новый персонаж. Вызывается и из раздела «Диалоги» («В каталог»).
    openCharacter(id) {
        if (this.open && String(id) === String(this.editingId)) return;
        if (!this.confirmDiscard()) return;

        const char = id === null ? null : store.characterById(id);
        if (id !== null && !char) {
            toast('Персонаж не найден в каталоге', 'error');
            return;
        }
        this.editingId = char ? char.id : null;
        this.open = true;

        this.el('gc-placeholder').classList.add('hidden');
        this.el('gc-editor').classList.remove('hidden');
        this.el('gc-title').textContent = char ? char.name.toUpperCase() : 'НОВЫЙ ПЕРСОНАЖ';
        this.el('gc-name').value = char ? char.name : '';
        const relation = this.el('gc-default-relation');
        relation.value = char ? (char.default_relation || 0) : 0;
        relation.style.setProperty('--rel-color', relationColor(parseInt(relation.value) || 0));
        this.el('gc-delete-btn').hidden = !char;
        this.el('gc-relations-section').hidden = !char;

        const image = char?.image || '';
        const select = this.el('gc-portrait-select');
        if (image && ![...select.options].some(o => o.value === image)) select.add(new Option(fileName(image), image));
        select.value = image;

        const p = readPortrait(char || {});
        this.portrait.set({ image, name: char?.name || '', scale: p.scale, xRel: p.xRel, yRel: p.yRel, mirror: p.mirror });

        this.markSaved();
        this.renderList();
        this.studio.updateHash();
        if (char) this.loadRelations(char.id);
        else this.el('gc-name').focus();
    }

    closeEditor() {
        this.open = false;
        this.editingId = null;
        this.markSaved();
        this.el('gc-editor').classList.add('hidden');
        this.el('gc-placeholder').classList.remove('hidden');
        this.renderList();
        this.studio.updateHash();
    }

    async save() {
        const name = this.el('gc-name').value.trim();
        if (!name) {
            toast('Введите имя персонажа', 'error');
            this.el('gc-name').focus();
            return;
        }
        const p = this.portrait.get();
        const form = new FormData();
        form.append('name', name);
        form.append('defaultRelation', parseInt(this.el('gc-default-relation').value) || 0);
        form.append('portraitScale', p.scale);
        form.append('portraitXRel', p.xRel);
        form.append('portraitYRel', p.yRel);
        // Пиксели базовой рамки — для старых клиентов, которые ещё читают portrait_x / portrait_y.
        form.append('portraitX', Math.round(p.xRel * BASE_FRAME.width * 100) / 100);
        form.append('portraitY', Math.round(p.yRel * BASE_FRAME.width * 100) / 100);
        form.append('portraitMirror', p.mirror ? '1' : '0');
        form.append('keepImage', this.el('gc-portrait-select').value);

        try {
            let id = this.editingId;
            if (id) {
                await api.characters.update(id, form);
            } else {
                const data = await api.characters.create(form);
                id = data.characterId;
            }
            this.markSaved();
            await store.loadCharacters();
            toast('Персонаж сохранён', 'success');
            this.open = false;
            this.openCharacter(id);
        } catch (error) {
            toast(`Ошибка сохранения: ${error.message}`, 'error');
        }
    }

    async remove() {
        const char = store.characterById(this.editingId);
        if (!char || !confirm(`Удалить персонажа «${char.name}»?`)) return;
        try {
            await api.characters.remove(char.id);
            this.markSaved();
            await store.loadCharacters();
            this.closeEditor();
            toast('Персонаж удалён', 'success');
        } catch (error) {
            toast(error.message, 'error');
        }
    }

    async uploadPortrait(event) {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        try {
            const data = await store.uploadFile('portrait', file);
            const select = this.el('gc-portrait-select');
            if (![...select.options].some(o => o.value === data.path)) select.add(new Option(fileName(data.path), data.path));
            select.value = data.path;
            this.portrait.setImage(data.path);
            this.markDirty();
            toast('Портрет загружен', 'success');
        } catch (error) {
            toast(`Ошибка загрузки: ${error.message}`, 'error');
        }
    }

    async initRelations() {
        if (!confirm('Создать записи отношений для всех пользователей и персонажей?')) return;
        try {
            const data = await api.relations.init();
            toast(data.message || 'Отношения инициализированы', 'success');
            if (this.editingId) this.loadRelations(this.editingId);
        } catch (error) {
            toast(`Ошибка инициализации: ${error.message}`, 'error');
        }
    }

    // ---------- отношения с игроками ----------

    async loadRelations(characterId) {
        const tbody = this.el('gc-relations-tbody');
        const loading = this.el('gc-relations-loading');
        loading.style.display = 'flex';
        tbody.textContent = '';

        try {
            const data = await api.relations.forCharacter(characterId);
            if (String(this.editingId) !== String(characterId)) return;  // успели открыть другого

            // Стартовые значения (пилот 0) и значения по пилотам — раздельно.
            const baseMap = {};
            this.relPilotMap = {};
            data.relations.forEach(r => {
                if (r.pilot_profile_id === 0) baseMap[r.user_id] = r;
                else this.relPilotMap[`${r.user_id}_${r.pilot_profile_id}`] = r;
            });
            const defaultRel = data.character?.default_relation || 0;

            if (!data.users.length) {
                tbody.innerHTML = '<tr><td colspan="3" class="text-center">Игроков пока нет</td></tr>';
            } else {
                tbody.innerHTML = data.users.map(user => {
                    const base = baseMap[user.id];
                    const value = base ? base.relation_value : defaultRel;
                    return `
                        <tr class="rel-user-row" data-user-id="${escapeAttr(user.id)}" data-gc-id="${escapeAttr(characterId)}">
                            <td>
                                <button type="button" class="rel-toggle" aria-expanded="false" aria-label="Пилоты">▸</button>
                                ${escapeHtml(user.username)}
                            </td>
                            <td>
                                <input type="number" class="form-input relation-value-input" value="${escapeAttr(value)}" min="-100" max="100" step="5" style="--rel-color:${relationColor(value)};" aria-label="Отношение">
                                <div class="form-help">Для всех пилотов аккаунта</div>
                            </td>
                            <td><button class="btn btn-small save-relation-btn" aria-label="Сохранить">✓</button></td>
                        </tr>
                        <tr class="rel-pilots-row" data-user-id="${escapeAttr(user.id)}" style="display:none;">
                            <td colspan="3" class="rel-pilots-cell"></td>
                        </tr>`;
                }).join('');
            }

            tbody.querySelectorAll('.save-relation-btn').forEach(btn => btn.addEventListener('click', e => {
                e.stopPropagation();
                const row = btn.closest('tr');
                this.saveRelation(row.dataset.gcId, row.dataset.userId, row.querySelector('.relation-value-input'), { global: true });
            }));
            tbody.querySelectorAll('.relation-value-input').forEach(input => this.bindRelationInput(input));
            tbody.querySelectorAll('.rel-user-row').forEach(row => row.addEventListener('click', e => {
                if (e.target.closest('input, label') || (e.target.closest('button') && !e.target.closest('.rel-toggle'))) return;
                this.togglePilots(row);
            }));
        } catch (error) {
            console.error('Error loading relations:', error);
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-danger">Ошибка загрузки</td></tr>';
        }
        loading.style.display = 'none';
    }

    bindRelationInput(input) {
        input.addEventListener('input', () => {
            input.style.setProperty('--rel-color', relationColor(parseInt(input.value) || 0));
            input.classList.add('is-dirty');
        });
    }

    async saveRelation(gcId, userId, input, extra) {
        const value = Math.max(-100, Math.min(100, parseInt(input.value) || 0));
        input.value = value;
        try {
            await api.relations.set(gcId, userId, { relationValue: value, ...extra });
            input.classList.remove('is-dirty');
            toast('Отношение сохранено', 'success');
        } catch (error) {
            toast(`Ошибка сохранения: ${error.message}`, 'error');
        }
    }

    async togglePilots(userRow) {
        const userId = userRow.dataset.userId;
        const gcId = userRow.dataset.gcId;
        const pilotsRow = userRow.nextElementSibling;
        if (!pilotsRow?.classList.contains('rel-pilots-row')) return;
        const cell = pilotsRow.querySelector('.rel-pilots-cell');
        const toggle = userRow.querySelector('.rel-toggle');
        const setOpen = open => {
            pilotsRow.style.display = open ? 'table-row' : 'none';
            toggle.textContent = open ? '▾' : '▸';
            toggle.setAttribute('aria-expanded', String(open));
        };

        if (pilotsRow.style.display !== 'none') return setOpen(false);
        setOpen(true);
        if (cell.dataset.loaded === '1') return;

        cell.innerHTML = '<span class="form-help">Загрузка пилотов...</span>';
        try {
            const pilots = (await api.getUserPilots(userId)).pilots || [];
            if (pilots.length === 0) {
                cell.innerHTML = '<span class="form-help">У пользователя нет пилотов.</span>';
                cell.dataset.loaded = '1';
                return;
            }
            const baseValue = parseInt(userRow.querySelector('.relation-value-input')?.value) || 0;
            cell.innerHTML = pilots.map(p => {
                const rel = this.relPilotMap[`${userId}_${p.id}`];
                const value = rel ? rel.relation_value : baseValue;
                const activeMark = p.is_active ? ' <span class="pilot-active-mark">● активен</span>' : '';
                return `
                    <div class="rel-pilot-item" data-pilot-id="${escapeAttr(p.id)}">
                        <span class="rel-pilot-name">${escapeHtml(p.callsign || ('Пилот ' + p.slot_number))}${activeMark}</span>
                        <input type="number" class="form-input rel-pilot-value-input" value="${escapeAttr(value)}" min="-100" max="100" step="5" style="--rel-color:${relationColor(value)};" aria-label="Отношение пилота">
                        <button class="btn btn-small rel-pilot-save-btn" aria-label="Сохранить">✓</button>
                    </div>`;
            }).join('');
            cell.querySelectorAll('.rel-pilot-value-input').forEach(input => this.bindRelationInput(input));
            cell.querySelectorAll('.rel-pilot-save-btn').forEach(btn => btn.addEventListener('click', () => {
                const item = btn.closest('.rel-pilot-item');
                this.saveRelation(gcId, userId, item.querySelector('.rel-pilot-value-input'), { pilotProfileId: parseInt(item.dataset.pilotId) });
            }));
            cell.dataset.loaded = '1';
        } catch (error) {
            console.error('Error loading pilots:', error);
            cell.innerHTML = '<span class="form-help text-danger">Ошибка загрузки пилотов</span>';
        }
    }
}
