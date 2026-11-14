// Раздел студии «Диалоги»: список слева, сведения, персонажи и дерево в центре.
// Реплика редактируется в модальном окне: ПКМ по реплике → «Редактировать», двойной клик или ✎.
import api from '../admin/admin-api.js';
import { toast, withBusy } from '../admin/admin-shell.js';
import debug from '../debug.js';
import { escapeHtml, escapeAttr } from '../escape-utils.js';
import { readPortrait, portraitCss } from '../portrait-frame.js';
import DialogueTreeVisualizer from './dialogue-tree-visualizer.js';
import { TOKENS, hasTokens, prepareConversation, applyTokens, tokenValues } from '../pilot-tokens.js';
import { planTyping, typingTimeline } from '../typing-text.js';
import { analyzeVoice } from '../voice-analysis.js';
import store, { assetUrl, fileName } from './studio-store.js';

const STATIC_PORTRAIT = 'assets/images/portraits/static.gif';
const CARD_THUMB_WIDTH = 46;

const option = (value, label) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`;

// Выставить значение списка. Если файла нет среди загруженных (лежит в другой папке или удалён),
// добавляем его отдельной строкой — иначе поле покажется пустым и при сохранении путь сотрётся.
function selectValue(select, value) {
    const v = value || '';
    if (v && ![...select.options].some(o => o.value === v)) {
        select.add(new Option(`${fileName(v)} (не из списка)`, v));
    }
    select.value = v;
}

// Пилоты для предпросмотра: как реплику увидят Кавалер в Доме, изгнанник и Лансер.
const PREVIEW_PILOTS = {
    cavalier: { callsign: 'RAVEN', full_name: 'леди Кассия-Вейл из Дома Стекла', gender: 'female', estate: 'cavalier', house_standing: 'member', house_key: 'glass' },
    exile: { callsign: 'VEX', full_name: 'Орсо из Дома Пыли', gender: 'male', estate: 'cavalier', house_standing: 'exile', house_key: 'dust' },
    lancer: { callsign: 'HAMMER', full_name: 'Тара Окс', gender: 'neutral', estate: 'lancer', house_standing: 'member' }
};
// Варианты реплики: основная звучит Лансеру, у Кавалера в Доме и изгнанника может быть своя.
const ESTATES = [
    { id: 'cavalier', title: 'Кавалеру в Доме', off: 'Выключено — Кавалер слышит основную реплику.' },
    { id: 'exile', title: 'Кавалеру-изгнаннику', off: 'Выключено — изгнанник слышит основную реплику, как Лансер.' }
];
const INFO_OPEN_KEY = 'studioDialogueInfoOpen';
// Разметка терминала ([1s], [Shake]…[ShakeE]) в предпросмотре не нужна.
const stripMarkup = text => String(text || '').replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();
// Русское число: plural(3, 'фраза', 'фразы', 'фраз') → «фразы».
function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
}
// Скорость по фразам из базы (typing_profile — JSON [[внутри, после], …]) или null.
function parseStoredProfile(raw) {
    if (!raw) return null;
    try {
        const list = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return Array.isArray(list) && list.length ? list : null;
    } catch {
        return null;
    }
}

export default class DialogueEditor {
    constructor(studio) {
        this.studio = studio;
        this.state = {
            currentDialogueId: null,
            dialogues: [],
            characters: [],
            branches: [],
            conversations: [],
            choices: [],
            variants: [],
            selectedAllowedUsers: [],
            audioPreview: null
        };
        this.treeVisualizer = null;
        this.el = id => document.getElementById(id);
    }

    async init() {
        this.initTreeVisualizer();
        this.initEventListeners();
        await this.loadDialogues();
        store.on('characters', () => {
            if (this.state.currentDialogueId) this.renderCharacters();
        });
    }

    initTreeVisualizer() {
        this.treeVisualizer = new DialogueTreeVisualizer('dialogue-tree-container', {
            nodeWidth: 200,
            nodeHeight: 80,
            rankSeparation: 120,
            nodeSeparation: 70
        });
        this.treeVisualizer.on('nodeEdit', node => this.openConversation(node.conversationId));
        this.treeVisualizer.on('nodeDelete', node => this.deleteConversation(node.conversationId));
        this.treeVisualizer.on('nodeAdd', afterNode => this.addConversationAfter(afterNode));
        this.treeVisualizer.on('nodeAddBefore', beforeNode => this.addConversationBefore(beforeNode));
        this.treeVisualizer.on('edgeCut', edge => this.cutEdge(edge));
        this.treeVisualizer.on('edgePointsChange', (edgeKey, points) => this.saveEdgePoints(edgeKey, points));
        this.treeVisualizer.on('connectionCreate', (from, to) => this.createChoiceConnection(from, to));
    }

    // ===================== список и выбор диалога =====================

    async loadDialogues() {
        try {
            const data = await api.dialogues.list();
            this.state.dialogues = data.dialogues || [];
        } catch (error) {
            this.state.dialogues = [];
            toast(`Диалоги не загрузились: ${error.message}`, 'error');
        }
        this.renderDialogueList();
    }

    renderDialogueList() {
        const container = this.el('dialogue-list');
        if (this.state.dialogues.length === 0) {
            container.innerHTML = '<div class="no-data">Нет диалогов</div>';
            return;
        }
        container.innerHTML = this.state.dialogues.map(d => `
            <button type="button" class="dialogue-item ${d.is_active === 0 ? 'dialogue-inactive' : ''} ${String(d.id) === String(this.state.currentDialogueId) ? 'active' : ''}" data-id="${escapeAttr(d.id)}">
                <span class="dialogue-item-frequency">${escapeHtml(d.frequency)}</span>
                <span class="dialogue-item-title">${escapeHtml(d.title || 'Без названия')}</span>
                ${d.is_active === 0 ? '<span class="dialogue-inactive-badge">Неактивен</span>' : ''}
            </button>`).join('');
        container.querySelectorAll('.dialogue-item').forEach(item =>
            item.addEventListener('click', () => this.selectDialogue(item.dataset.id)));
    }

    async selectDialogue(id, { keepPanel = false } = {}) {
        let data;
        try {
            data = await api.dialogues.get(id);
        } catch (error) {
            toast(`Диалог не открылся: ${error.message}`, 'error');
            return;
        }
        const switched = String(id) !== String(this.state.currentDialogueId);

        this.state.currentDialogueId = id;
        this.state.characters = data.characters || [];
        this.state.branches = data.branches || [];
        this.state.conversations = data.conversations || [];
        this.state.choices = data.choices || [];
        this.state.variants = data.variants || [];
        this.state.edgePoints = data.edgePoints || {};

        this.el('dialogue-list').querySelectorAll('.dialogue-item').forEach(item =>
            item.classList.toggle('active', item.dataset.id === String(id)));
        this.el('editor-placeholder').classList.add('hidden');
        this.el('editor-content').classList.remove('hidden');

        this.renderDialogueInfo(data.dialogue);
        this.renderCharacters();
        this.renderDialogueTree();
        this.updateCharacterSelects();
        this.updateBranchSelects();
        if (switched || !keepPanel) this.closeConversation();
        this.studio.updateHash();
    }

    get currentDialogueId() {
        return this.state.currentDialogueId;
    }

    reload() {
        return this.selectDialogue(this.state.currentDialogueId, { keepPanel: true });
    }

    renderDialogueInfo(dialogue) {
        this.el('dialogue-frequency').value = dialogue.frequency;
        this.el('dialogue-title').value = dialogue.title || '';
        let allowedUsers = [-1];
        try { allowedUsers = JSON.parse(dialogue.allowed_users || '[-1]'); } catch { /* старый формат */ }
        const isAllUsers = allowedUsers.includes(-1);
        this.el('dialogue-access').value = isAllUsers ? 'all' : 'custom';
        this.state.selectedAllowedUsers = isAllUsers ? [] : allowedUsers;
        this.el('dialogue-active').checked = dialogue.is_active !== 0;
        this.el('dialogue-max-repeats').value = dialogue.max_repeats !== undefined ? dialogue.max_repeats : 1;

        this.updateUsersSelector();
        this.el('users-selector').classList.toggle('hidden', isAllUsers);
        this.renderInfoSummary();
    }

    // Строка-сводка в заголовке «Информация о диалоге»: видна, когда блок свёрнут.
    renderInfoSummary() {
        const access = this.el('dialogue-access').value === 'all'
            ? 'доступ всем'
            : `доступ: ${this.state.selectedAllowedUsers.length} игр.`;
        const repeats = parseInt(this.el('dialogue-max-repeats').value);
        const chips = [
            { text: this.el('dialogue-frequency').value || '—', cls: 'chip-freq' },
            { text: this.el('dialogue-title').value || 'Без названия' },
            { text: this.el('dialogue-active').checked ? 'активен' : 'неактивен', cls: this.el('dialogue-active').checked ? 'chip-on' : 'chip-off' },
            { text: access },
            { text: repeats === -1 ? 'повторы ∞' : `повторов: ${Number.isFinite(repeats) ? repeats : 1}` }
        ];
        const host = this.el('dialogue-summary');
        host.textContent = '';
        chips.forEach(c => {
            const chip = document.createElement('span');
            chip.className = `info-chip ${c.cls || ''}`.trim();
            chip.textContent = c.text;
            host.appendChild(chip);
        });
    }

    updateUsersSelector() {
        const container = this.el('users-list');
        container.innerHTML = store.users.map(user => `
            <div class="user-item">
                <input type="checkbox" id="user-${escapeAttr(user.id)}" value="${escapeAttr(user.id)}"
                    ${this.state.selectedAllowedUsers.includes(user.id) ? 'checked' : ''}>
                <label for="user-${escapeAttr(user.id)}">${escapeHtml(user.username)} (ID: ${escapeHtml(user.id)})</label>
            </div>`).join('');
        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', e => {
                const userId = parseInt(e.target.value);
                const list = this.state.selectedAllowedUsers.filter(uid => uid !== userId);
                if (e.target.checked) list.push(userId);
                this.state.selectedAllowedUsers = list;
            });
        });
    }

    // ===================== персонажи диалога =====================

    characterName(c) {
        return c.gc_name || c.name || 'Без имени';
    }

    renderCharacters() {
        const container = this.el('characters-container');
        if (this.state.characters.length === 0) {
            container.innerHTML = '<div class="no-data">Персонажи не добавлены</div>';
            return;
        }
        container.textContent = '';
        this.state.characters.forEach(c => {
            const card = document.createElement('div');
            card.className = 'character-card';
            card.dataset.id = c.id;

            // Миниатюра — тем же кадром, что в терминале (портрет из каталога).
            const thumb = document.createElement('div');
            thumb.className = 'character-portrait';
            const image = c.gc_image || c.image;
            thumb.style.backgroundImage = `url("${assetUrl(image || STATIC_PORTRAIT)}")`;
            if (image) {
                const css = portraitCss(readPortrait(c), CARD_THUMB_WIDTH);
                thumb.style.backgroundSize = css.backgroundSize;
                thumb.style.backgroundPosition = css.backgroundPosition;
                thumb.style.transform = css.transform;
            }

            const info = document.createElement('div');
            info.className = 'character-info';
            info.innerHTML = '<div class="character-name"></div><div class="character-window-label"></div>';
            info.querySelector('.character-name').textContent = this.characterName(c);
            info.querySelector('.character-window-label').textContent = `Окно ${c.window} (${String(c.window) === '2' ? 'справа' : 'слева'})`;

            const actions = document.createElement('div');
            actions.className = 'character-actions';
            if (c.global_character_id) {
                const toCatalog = document.createElement('button');
                toCatalog.className = 'btn btn-small';
                toCatalog.textContent = 'В каталог';
                toCatalog.title = 'Открыть персонажа в разделе «Персонажи»';
                toCatalog.addEventListener('click', () => this.studio.openCharacter(c.global_character_id));
                actions.appendChild(toCatalog);
            }
            const edit = document.createElement('button');
            edit.className = 'btn btn-small';
            edit.textContent = 'Окно и звук';
            edit.addEventListener('click', () => this.openCharacterModal(c.id));
            const remove = document.createElement('button');
            remove.className = 'btn btn-small btn-danger';
            remove.textContent = 'Удалить';
            remove.addEventListener('click', () => this.deleteCharacter(c.id));
            actions.append(edit, remove);

            card.append(thumb, info, actions);
            container.appendChild(card);
        });
    }

    updateCharacterSelects() {
        const select = this.el('conversation-character');
        const current = select.value;
        select.innerHTML = option('', 'Выберите персонажа') +
            this.state.characters.map(c => option(c.id, this.characterName(c))).join('');
        select.value = current;
    }

    updateBranchSelects() {
        const select = this.el('conversation-branch-select');
        const current = select.value;
        select.innerHTML = option('main', 'Главная ветка') +
            this.state.branches.filter(b => b.branch_id !== 'main').map(b => option(b.branch_id, b.branch_id)).join('');
        select.value = current || 'main';
    }

    openCharacterModal(id = null) {
        this.el('character-global-select').innerHTML = option('', 'Выберите персонажа...') +
            store.globalCharacters.map(gc => option(gc.id, gc.name)).join('');
        this.fillSoundSelect();

        const char = id ? this.state.characters.find(c => String(c.id) === String(id)) : null;
        this.el('character-id').value = char ? char.id : '';
        this.el('character-global-select').value = char?.global_character_id || '';
        this.el('character-global-select').disabled = !!char;
        this.el('character-window').value = char ? char.window : '1';
        selectValue(this.el('character-voice'), char?.voice);
        this.el('character-voice-mode').value = char?.voice_mode || 'none';
        this.updateVoiceModeUI(char?.voice_mode || 'none');
        this.el('character-modal').style.display = 'flex';
    }

    fillSoundSelect() {
        const select = this.el('character-voice');
        const current = select.value;
        select.innerHTML = option('', 'Выберите файл...') + store.files.sounds.map(s => option(s, fileName(s))).join('');
        select.value = current;
    }

    updateVoiceModeUI(mode) {
        this.el('voice-typing-section').classList.toggle('hidden', mode !== 'typing');
    }

    async saveCharacter() {
        const id = this.el('character-id').value;
        const globalCharacterId = parseInt(this.el('character-global-select').value);
        const window = parseInt(this.el('character-window').value);
        const voiceMode = this.el('character-voice-mode').value;
        const voice = voiceMode === 'typing' ? this.el('character-voice').value : '';

        if (!id && !globalCharacterId) {
            toast('Выберите персонажа из каталога', 'error');
            return;
        }
        try {
            if (id) {
                await api.dialogueCharacters.update(id, { voice, voiceMode, voiceDuration: 0, window });
            } else {
                await api.dialogueCharacters.create({ dialogueId: this.state.currentDialogueId, globalCharacterId, voice, voiceMode, voiceDuration: 0, window });
            }
            this.el('character-modal').style.display = 'none';
            await this.reload();
        } catch (error) {
            toast(`Ошибка сохранения персонажа: ${error.message}`, 'error');
        }
    }

    async deleteCharacter(id) {
        if (!confirm('Убрать персонажа из диалога?')) return;
        try {
            await api.dialogueCharacters.remove(id);
            await this.reload();
        } catch (error) {
            toast(`Ошибка удаления: ${error.message}`, 'error');
        }
    }

    // ===================== дерево =====================

    renderDialogueTree() {
        const addBtn = this.el('add-conversation-btn');
        const hasConversations = this.state.conversations.length > 0;
        addBtn.disabled = hasConversations;
        addBtn.title = hasConversations ? 'Новые реплики добавляются через контекстное меню реплики в дереве' : '';
        this.treeVisualizer.setData({
            // Узлы с вариантом для сословия помечаются значком «⇄ Л» / «⇄ К».
            conversations: this.state.conversations.map(c => ({
                ...c,
                variant_audiences: this.state.variants.filter(v => String(v.conversation_id) === String(c.id)).map(v => v.audience)
            })),
            branches: this.state.branches,
            choices: this.state.choices,
            characters: this.state.characters,
            edgePoints: this.state.edgePoints
        });
        this.treeVisualizer.autoLayout();
    }

    addConversationAfter(afterNode) {
        if (afterNode?.hasChoice) {
            toast('Нельзя добавить реплику после реплики с выбором', 'error');
            return;
        }
        this.openConversation(null, afterNode ? afterNode.branchId : 'main');
    }

    async addConversationBefore(beforeNode) {
        if (!beforeNode) return;
        try {
            await api.conversations.shift({
                dialogueId: this.state.currentDialogueId,
                branchId: beforeNode.branchId,
                fromSortOrder: beforeNode.sortOrder
            });
            this.openConversation(null, beforeNode.branchId, beforeNode.sortOrder);
        } catch (error) {
            toast(error.message || 'Ошибка сдвига реплик', 'error');
        }
    }

    // Перемычки сохраняются сразу после постановки, перетаскивания или удаления.
    async saveEdgePoints(edgeKey, points) {
        if (points.length) this.state.edgePoints[edgeKey] = points.map(p => ({ ...p }));
        else delete this.state.edgePoints[edgeKey];
        try {
            await api.dialogues.saveEdgePoints(this.state.currentDialogueId, edgeKey, points);
        } catch (error) {
            toast(`Перемычка не сохранилась: ${error.message}`, 'error');
        }
    }

    // Ножницы: связь обрезана — диалог перестраивается, отрезанная часть становится отдельным деревом.
    async cutEdge(edge) {
        try {
            const data = await api.conversations.cut(edge);
            toast(edge.type === 'choice'
                ? 'Связь ответа обрезана: ответ теперь завершает диалог'
                : `Связь обрезана: отдельно ${data.moved || 1} реплик(а)`, 'success');
            await this.reload();
        } catch (error) {
            toast(error.message || 'Ошибка обрезки связи', 'error');
        }
    }

    async createChoiceConnection(fromNode, toNode) {
        if (fromNode.hasChoice) return toast('Нельзя создать связь от реплики с выбором', 'error');
        if (toNode.hasChoice) return toast('Нельзя создать связь к реплике с выбором', 'error');
        try {
            await api.conversations.link({ fromConversationId: fromNode.conversationId, toConversationId: toNode.conversationId });
            await this.reload();
        } catch (error) {
            toast(error.message || 'Ошибка создания связи', 'error');
        }
    }

    // ===================== редактор реплики (модальное окно) =====================

    openConversation(id = null, defaultBranch = 'main', forcedSortOrder = null) {
        debug('openConversation', id, defaultBranch, forcedSortOrder);
        this.updateCharacterSelects();
        this.updateBranchSelects();

        this.el('conversation-custom-image').innerHTML = option('', 'По умолчанию') +
            store.files.portraits.map(p => option(p, fileName(p))).join('');
        this.fillVoicelineSelect();

        const conv = id ? this.state.conversations.find(c => String(c.id) === String(id)) : null;
        if (id && !conv) {
            toast('Реплика не найдена — обновите диалог', 'error');
            return;
        }

        this.el('conversation-panel-title').textContent = conv ? 'Редактор реплики' : 'Новая реплика';
        this.el('conversation-id').value = conv ? conv.id : '';
        this.el('conversation-character').value = conv ? conv.character_id : '';
        this.el('conversation-branch-select').value = conv ? conv.branch_id : defaultBranch;
        this.el('conversation-text').value = conv ? conv.text : '';
        selectValue(this.el('conversation-custom-image'), conv?.custom_image);
        this.el('conversation-fake-name').value = conv?.fake_name || '';
        selectValue(this.el('conversation-voiceline'), conv?.voiceline);
        this.el('conversation-typing-speed').value = conv?.typing_speed || 0;
        this.el('conversation-voice-offset').value = conv?.voice_offset || 0;
        this.stopTypingPreview();
        this.setTypingProfile(this.typingUi(), parseStoredProfile(conv?.typing_profile));
        this.el('conversation-forced-sort').value = !conv && forcedSortOrder !== null ? forcedSortOrder : '';

        this.fillVariantFields(conv);

        const choices = conv ? this.state.choices.filter(ch => String(ch.conversation_id) === String(conv.id)) : [];
        this.removedOptionIds = new Set();
        this.el('has-choice').checked = choices.length > 0;
        this.el('choice-options-container').classList.toggle('hidden', choices.length === 0);
        this.el('choice-id').value = choices.length ? choices[0].choice_id : '';
        this.el('choice-options-list').textContent = '';
        if (choices.length) this.renderChoiceOptions(choices);

        const modal = this.el('conversation-modal');
        modal.style.display = 'flex';
        modal.querySelector('.modal-body').scrollTop = 0;
        if (conv) this.treeVisualizer.highlightNode?.(conv.id);
        this.lastTokenTarget = this.el('conversation-text');
        this.updateConversationHints();
        this.el('conversation-text').focus();
    }

    // ===================== вариант для сословия и метки пилота =====================

    variantsOf(conversationId) {
        const map = {};
        this.state.variants
            .filter(v => String(v.conversation_id) === String(conversationId))
            .forEach(v => { map[v.audience] = v; });
        return map;
    }

    voicelineOptions(empty = 'Без озвучки (звук персонажа)') {
        return option('', empty) + store.files.voicelines.map(v => option(v, fileName(v))).join('');
    }

    // Блоки «Кавалеру в Доме» и «Кавалеру-изгнаннику», у каждого своя галочка включения.
    fillVariantFields(conv) {
        const variants = conv ? this.variantsOf(conv.id) : {};
        const host = this.el('variant-fields');
        host.textContent = '';
        this.variantBlocks = {};

        ESTATES.forEach(estate => {
            const fragment = this.el('variant-block-template').content.cloneNode(true);
            const block = fragment.querySelector('.variant-block');
            const v = variants[estate.id] || null;
            const q = cls => block.querySelector(cls);
            block.dataset.audience = estate.id;
            q('.variant-title').textContent = estate.title;
            q('.variant-off-note').textContent = estate.off;
            q('.variant-voiceline').innerHTML = this.voicelineOptions();
            q('.variant-custom-image').innerHTML = option('', 'Как у основной') +
                store.files.portraits.map(p => option(p, fileName(p))).join('');

            q('.variant-enabled').checked = !!v;
            q('.variant-text').value = v?.text || '';
            selectValue(q('.variant-voiceline'), v?.voiceline);
            q('.variant-fake-name').value = v?.fake_name || '';
            selectValue(q('.variant-custom-image'), v?.custom_image);
            q('.variant-typing-speed').value = v?.typing_speed || 0;
            q('.variant-voice-offset').value = v?.voice_offset || 0;
            const typing = this.typingUi(block);
            this.setTypingProfile(typing, parseStoredProfile(v?.typing_profile));

            const sync = () => {
                const on = q('.variant-enabled').checked;
                block.classList.toggle('is-off', !on);
                q('.variant-body').hidden = !on;
                q('.variant-off-note').hidden = on;
            };
            q('.variant-enabled').addEventListener('change', () => {
                sync();
                if (q('.variant-enabled').checked) q('.variant-text').focus();
                this.updateConversationHints();
            });
            q('.variant-preview').addEventListener('click', () => this.previewSound(q('.variant-voiceline')));
            q('.variant-upload-btn').addEventListener('click', () => q('.variant-upload').click());
            q('.variant-upload').addEventListener('change', e => this.uploadFile(e, 'voiceline', q('.variant-voiceline')));
            this.bindTypingControls(typing);
            q('.variant-voiceline').addEventListener('change', () => this.updateConversationHints());
            sync();

            this.variantBlocks[estate.id] = block;
            host.appendChild(block);
        });

        const any = Object.keys(variants).length > 0;
        this.el('has-variant').checked = any;
        host.hidden = !any;
    }

    enabledVariantBlocks() {
        if (!this.el('has-variant').checked) return [];
        return Object.entries(this.variantBlocks || {})
            .filter(([, block]) => block.querySelector('.variant-enabled').checked);
    }

    // Реплика из формы в формате терминала — для предпросмотра.
    formConversation() {
        const char = this.state.characters.find(c => String(c.id) === this.el('conversation-character').value);
        const conv = {
            speaker: char ? this.characterName(char) : 'Персонаж',
            text: this.el('conversation-text').value,
            fakeName: this.el('conversation-fake-name').value
        };
        const variants = {};
        this.enabledVariantBlocks().forEach(([audience, block]) => {
            const text = block.querySelector('.variant-text').value;
            if (text.trim()) variants[audience] = { text, fakeName: block.querySelector('.variant-fake-name').value };
        });
        if (Object.keys(variants).length) conv.variants = variants;
        return conv;
    }

    unknownTokens(text) {
        return [...String(text || '').matchAll(/<([A-Za-z]+)>/g)]
            .map(m => m[1]).filter(t => !TOKENS.includes(t));
    }

    updateConversationHints() {
        const warn = (id, text) => {
            const unknown = [...new Set(this.unknownTokens(text))];
            const el = this.el(id);
            el.hidden = unknown.length === 0;
            el.textContent = unknown.length
                ? `Неизвестная метка ${unknown.map(t => `<${t}>`).join(', ')} — в терминале выведется как есть. Доступны: ${TOKENS.map(t => `<${t}>`).join(' ')}.`
                : '';
        };
        const warnEl = (el, text) => {
            const unknown = [...new Set(this.unknownTokens(text))];
            el.hidden = unknown.length === 0;
            el.textContent = unknown.length
                ? `Неизвестная метка ${unknown.map(t => `<${t}>`).join(', ')} — в терминале выведется как есть. Доступны: ${TOKENS.map(t => `<${t}>`).join(' ')}.`
                : '';
        };
        warn('conversation-token-warning', `${this.el('conversation-text').value} ${this.el('conversation-fake-name').value}`);
        this.el('conversation-voice-hint').hidden = !(this.el('conversation-voiceline').value && hasTokens(this.el('conversation-text').value));

        Object.values(this.variantBlocks || {}).forEach(block => {
            const text = block.querySelector('.variant-text').value;
            warnEl(block.querySelector('.variant-token-warning'), `${text} ${block.querySelector('.variant-fake-name').value}`);
            block.querySelector('.variant-voice-hint').hidden = !(block.querySelector('.variant-voiceline').value && hasTokens(text));
            this.refreshTypingProfile(this.typingUi(block));
        });
        this.refreshTypingProfile(this.typingUi());

        const conv = this.formConversation();
        document.querySelectorAll('.conversation-preview .preview-line').forEach(line => {
            const shown = prepareConversation(conv, PREVIEW_PILOTS[line.dataset.audience]);
            const name = shown.fakeName || shown.speaker;
            line.querySelector('.preview-text').textContent = `${name}: ${stripMarkup(shown.text) || '…'}`;
            line.classList.toggle('is-variant', !!shown.variantAudience);
            line.title = shown.variantAudience ? 'Звучит вариант реплики' : 'Звучит основная реплика';
        });
    }

    insertToken(token) {
        // Кнопки меток не забирают фокус (mousedown → preventDefault), поэтому активное поле —
        // то, в котором пользователь печатал. Запасной вариант — последнее поле с фокусом.
        const active = document.activeElement;
        const target = active?.matches?.('[data-token-target]') && !active.disabled
            ? active
            : (this.lastTokenTarget?.isConnected ? this.lastTokenTarget : this.el('conversation-text'));
        const text = `<${token}>`;
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        target.value = target.value.slice(0, start) + text + target.value.slice(end);
        target.focus();
        target.setSelectionRange(start + text.length, start + text.length);
        this.updateConversationHints();
    }

    // Варианты для Кавалера и изгнанника: включённые сохраняются, выключенные удаляются.
    async saveVariants(conversationId) {
        const existing = this.variantsOf(conversationId);
        const enabled = new Map(this.enabledVariantBlocks());
        for (const estate of ESTATES) {
            const block = enabled.get(estate.id);
            if (!block) {
                if (existing[estate.id]) await api.conversations.removeVariant(conversationId, estate.id);
                continue;
            }
            await api.conversations.saveVariant(conversationId, estate.id, {
                text: block.querySelector('.variant-text').value.trim(),
                voiceline: block.querySelector('.variant-voiceline').value,
                fakeName: block.querySelector('.variant-fake-name').value.trim(),
                customImage: block.querySelector('.variant-custom-image').value,
                typingSpeed: parseFloat(block.querySelector('.variant-typing-speed').value) || 0,
                voiceOffset: parseInt(block.querySelector('.variant-voice-offset').value, 10) || 0,
                typingProfile: this.typingProfileOf(this.typingUi(block))
            });
        }
    }

    closeConversation() {
        this.stopTypingPreview();
        this.el('conversation-modal').style.display = 'none';
    }

    fillVoicelineSelect() {
        const select = this.el('conversation-voiceline');
        const current = select.value;
        select.innerHTML = option('', 'Без озвучки (звук персонажа)') +
            store.files.voicelines.map(v => option(v, fileName(v))).join('');
        select.value = current;
    }

    renderChoiceOptions(choices) {
        const container = this.el('choice-options-list');
        container.textContent = '';
        choices.forEach(ch => this.addChoiceOption(ch));
    }

    // Персонажи диалога, привязанные к каталогу: с ними может меняться отношение.
    relationCharacters() {
        const seen = new Set();
        return this.state.characters.filter(c => {
            if (!c.global_character_id || seen.has(c.global_character_id)) return false;
            seen.add(c.global_character_id);
            return true;
        });
    }

    // ch — строка choice_options (или пусто для нового ответа).
    addChoiceOption(ch = null) {
        const container = this.el('choice-options-list');
        const fragment = this.el('choice-option-template').content.cloneNode(true);
        const optionDiv = fragment.querySelector('.choice-option');
        const q = cls => optionDiv.querySelector(cls);
        optionDiv.dataset.optionId = ch?.option_id || `opt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        if (ch?.id) optionDiv.dataset.dbId = ch.id;

        q('.option-text').value = ch?.option_text || '';

        // Куда ведёт ответ; для новой ветки — кто говорит её первую реплику (по умолчанию тот же персонаж).
        const targetSelect = q('.option-target');
        targetSelect.innerHTML = option('', 'Новая ветка') + option('__end__', 'Никуда — завершает диалог') +
            this.state.branches.map(b => option(b.branch_id, b.branch_id)).join('');
        // У сохранённого ответа без ветки (например, после ножниц) — «никуда», а не «новая ветка».
        targetSelect.value = ch?.target_branch || (ch?.id ? '__end__' : '');
        const speakerSelect = q('.option-character');
        speakerSelect.innerHTML = option('', 'Говорит: тот же персонаж') +
            this.state.characters.map(c => option(c.id, `Говорит: ${this.characterName(c)}`)).join('');
        const syncTarget = () => speakerSelect.classList.toggle('hidden', targetSelect.value !== '');
        targetSelect.addEventListener('change', syncTarget);
        syncTarget();

        // Альтернативный ответ для сословия
        const estatesFields = q('.option-estates-fields');
        const texts = { cavalier: ch?.option_text_cavalier || '', exile: ch?.option_text_exile || '' };
        optionDiv.querySelectorAll('.option-estate-row').forEach(row => {
            const enabled = row.querySelector('.option-estate-enabled');
            const input = row.querySelector('.option-estate-text');
            input.value = texts[row.dataset.audience];
            enabled.checked = !!input.value;
            const sync = () => { input.disabled = !enabled.checked; row.classList.toggle('is-off', !enabled.checked); };
            enabled.addEventListener('change', () => { sync(); if (enabled.checked) input.focus(); });
            sync();
        });
        q('.option-estates-enabled').checked = !!(texts.cavalier || texts.exile);
        estatesFields.hidden = !q('.option-estates-enabled').checked;
        q('.option-estates-enabled').addEventListener('change', e => { estatesFields.hidden = !e.target.checked; });

        // Отношения: без персонажа ответ ни на чьё отношение не влияет.
        const relationSection = q('.choice-option-relation');
        const relationChar = q('.relation-character');
        relationChar.innerHTML = option('', '— ни с кем (не влияет) —') +
            this.relationCharacters().map(c => option(c.global_character_id, this.characterName(c))).join('');
        selectValue(relationChar, ch?.relation_global_char_id ? String(ch.relation_global_char_id) : '');
        if (ch?.relation_global_char_id) {
            q('.relation-min').value = ch.relation_require_min ?? -100;
            q('.relation-max').value = ch.relation_require_max ?? 100;
            q('.relation-effect').value = ch.relation_effect || 0;
        }
        const syncRelation = () => {
            const none = !relationChar.value;
            ['.relation-min', '.relation-max', '.relation-effect'].forEach(cls => { q(cls).disabled = none; });
            const effect = parseInt(q('.relation-effect').value) || 0;
            q('.relation-summary').textContent = none
                ? 'Отношения: не меняются'
                : `Отношения: ${relationChar.selectedOptions[0]?.textContent || ''}${effect ? ` ${effect > 0 ? '+' : '−'}${Math.abs(effect)}` : ''}`;
            relationSection.classList.toggle('has-relation', !none);
        };
        relationChar.addEventListener('change', syncRelation);
        q('.relation-effect').addEventListener('input', syncRelation);
        syncRelation();

        const icon = q('.relation-toggle-icon');
        const header = q('.relation-header');
        const setExpanded = expanded => {
            relationSection.classList.toggle('expanded', expanded);
            icon.textContent = expanded ? '▼' : '▶';
            header.setAttribute('aria-expanded', String(expanded));
        };
        header.addEventListener('click', () => setExpanded(!relationSection.classList.contains('expanded')));

        q('.remove-option-btn').addEventListener('click', () => {
            if (optionDiv.dataset.dbId) this.removedOptionIds.add(optionDiv.dataset.dbId);
            optionDiv.remove();
        });
        container.appendChild(optionDiv);
    }

    async saveConversation() {
        const id = this.el('conversation-id').value;
        const characterId = this.el('conversation-character').value;
        const branchId = this.el('conversation-branch-select').value;
        const text = this.el('conversation-text').value;
        const customImage = this.el('conversation-custom-image').value;
        const fakeName = this.el('conversation-fake-name').value;
        const voiceline = this.el('conversation-voiceline').value;
        const typingSpeed = parseFloat(this.el('conversation-typing-speed').value) || 0;
        const voiceOffset = parseInt(this.el('conversation-voice-offset').value, 10) || 0;
        const hasChoice = this.el('has-choice').checked;

        if (!characterId || !text) {
            toast('Выберите персонажа и введите текст', 'error');
            return;
        }
        const emptyVariant = this.enabledVariantBlocks().find(([, block]) => !block.querySelector('.variant-text').value.trim());
        if (emptyVariant) {
            const title = ESTATES.find(e => e.id === emptyVariant[0]).title;
            toast(`Введите текст реплики «${title}» или снимите у неё галочку`, 'error');
            emptyVariant[1].querySelector('.variant-text').focus();
            return;
        }
        const emptyEstateAnswer = [...this.el('choice-options-list').querySelectorAll('.option-estate-row')]
            .find(row => hasChoice && row.querySelector('.option-estate-enabled').checked
                && !row.closest('.option-estates-fields').hidden
                && !row.querySelector('.option-estate-text').value.trim());
        if (emptyEstateAnswer) {
            toast('Введите текст альтернативного ответа или снимите у него галочку', 'error');
            emptyEstateAnswer.querySelector('.option-estate-text').focus();
            return;
        }

        let sortOrder;
        if (!id) {
            const forced = this.el('conversation-forced-sort').value;
            if (forced !== '') {
                sortOrder = parseInt(forced);
            } else {
                const maxSort = this.state.conversations.filter(c => c.branch_id === branchId)
                    .reduce((max, c) => Math.max(max, c.sort_order || 0), -1);
                sortOrder = maxSort + 1;
            }
        } else {
            sortOrder = this.state.conversations.find(c => String(c.id) === String(id))?.sort_order;
        }

        const typingProfile = this.typingProfileOf(this.typingUi());
        const fields = { branchId, characterId, text, customImage, fakeName, voiceline, typingSpeed, voiceOffset, typingProfile, sortOrder };
        try {
            let conversationId = id;
            if (id) {
                await api.conversations.update(id, fields);
            } else {
                const data = await api.conversations.create({ dialogueId: this.state.currentDialogueId, ...fields });
                conversationId = data.conversationId;
            }
            if (hasChoice) {
                if (!(await this.saveChoices(conversationId))) return;
            } else {
                // Галочку «Добавить выбор» сняли — варианты ответа удаляются (ветки остаются).
                const existing = this.state.choices.filter(ch => String(ch.conversation_id) === String(conversationId));
                for (const ch of existing) await api.choices.remove(ch.id);
            }
            await this.saveVariants(conversationId);

            toast('Реплика сохранена', 'success');
            this.closeConversation();
            await this.reload();
        } catch (error) {
            toast(`Ошибка сохранения реплики: ${error.message}`, 'error');
        }
    }

    // Возвращает false, если сохранение прервано.
    async saveChoices(conversationId) {
        const choiceId = this.el('choice-id').value || `choice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const speakerId = this.el('conversation-character').value;

        // Ответы, убранные крестиком, удаляются из базы.
        for (const id of this.removedOptionIds || []) await api.choices.remove(id);
        this.removedOptionIds = new Set();

        const options = [...this.el('choice-options-list').querySelectorAll('.choice-option')].map((opt, i) => {
            const q = cls => opt.querySelector(cls);
            const estatesOn = q('.option-estates-enabled').checked;
            const estateText = audience => {
                const row = opt.querySelector(`.option-estate-row[data-audience="${audience}"]`);
                return estatesOn && row.querySelector('.option-estate-enabled').checked
                    ? row.querySelector('.option-estate-text').value.trim() : '';
            };
            const relationCharId = parseInt(q('.relation-character').value) || null;
            const targetBranch = q('.option-target').value;
            return {
                dbId: opt.dataset.dbId || null,
                optionId: opt.dataset.optionId,
                optionText: q('.option-text').value.trim(),
                optionTextCavalier: estateText('cavalier'),
                optionTextExile: estateText('exile'),
                targetBranch,
                isNewBranch: targetBranch === '',
                // Первая реплика новой ветки — у выбранного персонажа, иначе у того же, кто говорит сейчас.
                newBranchSpeakerId: q('.option-character').value || speakerId,
                sortOrder: i,
                // Без персонажа отношения не меняются (сервер сбросит пороги и эффект).
                relationGlobalCharId: relationCharId,
                relationRequireMin: parseInt(q('.relation-min').value),
                relationRequireMax: parseInt(q('.relation-max').value),
                relationEffect: parseInt(q('.relation-effect').value) || 0
            };
        });

        for (const opt of options) {
            if (!opt.optionText) continue;
            const payload = {
                conversationId,
                choiceId,
                optionId: opt.optionId,
                optionText: opt.optionText,
                optionTextCavalier: opt.optionTextCavalier,
                optionTextExile: opt.optionTextExile,
                sortOrder: opt.sortOrder,
                relationGlobalCharId: opt.relationGlobalCharId,
                relationRequireMin: opt.relationRequireMin,
                relationRequireMax: opt.relationRequireMax,
                relationEffect: opt.relationEffect
            };

            if (opt.isNewBranch) {
                if (opt.dbId) await api.choices.remove(opt.dbId);   // ответ переводят в новую ветку
                try {
                    await api.branches.createWithConversation({
                        ...payload,
                        dialogueId: this.state.currentDialogueId,
                        branchId: `branch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                        characterId: opt.newBranchSpeakerId
                    });
                } catch (error) {
                    toast(error.message || 'Ошибка создания ветки', 'error');
                    return false;
                }
                continue;
            }

            payload.targetBranch = opt.targetBranch === '__end__' ? null : opt.targetBranch;
            if (opt.dbId) await api.choices.update(opt.dbId, payload);
            else await api.choices.create(payload);
        }
        return true;
    }

    async deleteConversation(id) {
        if (!confirm('Удалить реплику?')) return;
        try {
            await api.conversations.remove(id);
            if (this.el('conversation-id').value === String(id)) this.closeConversation();
            await this.reload();
        } catch (error) {
            toast(`Ошибка удаления: ${error.message}`, 'error');
        }
    }

    // ===================== диалог целиком =====================

    async createDialogue() {
        const frequency = this.el('new-dialogue-frequency').value.trim();
        const title = this.el('new-dialogue-title').value.trim();
        if (!frequency) {
            toast('Укажите частоту', 'error');
            return;
        }
        try {
            const data = await api.dialogues.create({ frequency, title });
            this.el('new-dialogue-modal').style.display = 'none';
            this.el('new-dialogue-frequency').value = '';
            this.el('new-dialogue-title').value = '';
            await this.loadDialogues();
            await this.selectDialogue(data.dialogueId);
        } catch (error) {
            toast(error.message || 'Ошибка создания диалога', 'error');
        }
    }

    async saveDialogue() {
        const body = {
            frequency: this.el('dialogue-frequency').value.trim(),
            title: this.el('dialogue-title').value.trim(),
            allowedUsers: this.el('dialogue-access').value === 'all' ? [-1] : this.state.selectedAllowedUsers,
            isActive: this.el('dialogue-active').checked,
            maxRepeats: parseInt(this.el('dialogue-max-repeats').value) || 1
        };
        try {
            await api.dialogues.update(this.state.currentDialogueId, body);
            toast('Диалог сохранён', 'success');
            this.renderInfoSummary();
            await this.loadDialogues();
        } catch (error) {
            toast(error.message || 'Ошибка сохранения', 'error');
        }
    }

    async deleteDialogue() {
        if (!confirm('Удалить диалог и все связанные данные?')) return;
        try {
            await api.dialogues.remove(this.state.currentDialogueId);
            this.state.currentDialogueId = null;
            this.closeConversation();
            this.el('editor-placeholder').classList.remove('hidden');
            this.el('editor-content').classList.add('hidden');
            await this.loadDialogues();
            this.studio.updateHash();
            toast('Диалог удалён', 'success');
        } catch (error) {
            toast(`Ошибка удаления: ${error.message}`, 'error');
        }
    }

    // ===================== звук =====================

    previewSound(select) {
        const el = typeof select === 'string' ? this.el(select) : select;
        const path = el?.value;
        if (!path) return;
        this.state.audioPreview?.pause();
        this.state.audioPreview = new Audio(assetUrl(path));
        this.state.audioPreview.play().catch(err => debug('Audio play error:', err));
    }

    // ===================== печать под озвучку (ROADMAP, задача 9) =====================

    // Поля печати основной реплики (block = null) или варианта для сословия.
    typingUi(block = null) {
        if (!block) {
            return {
                speed: this.el('conversation-typing-speed'),
                offset: this.el('conversation-voice-offset'),
                profile: this.el('conversation-typing-profile'),
                note: this.el('conversation-typing-profile-note'),
                preview: this.el('conversation-typing-preview'),
                auto: this.el('auto-calc-speed-btn'),
                check: this.el('preview-typing-btn'),
                voiceline: this.el('conversation-voiceline'),
                text: this.el('conversation-text'),
                audience: 'lancer'
            };
        }
        const q = cls => block.querySelector(cls);
        return {
            speed: q('.variant-typing-speed'),
            offset: q('.variant-voice-offset'),
            profile: q('.variant-typing-profile'),
            note: q('.variant-typing-profile-note'),
            preview: q('.variant-typing-preview'),
            auto: q('.variant-auto-speed'),
            check: q('.variant-preview-typing'),
            voiceline: q('.variant-voiceline'),
            text: q('.variant-text'),
            audience: block.dataset.audience
        };
    }

    bindTypingControls(ui) {
        ui.auto.addEventListener('click', () => this.autoCalculateTypingSpeed(ui));
        ui.check.addEventListener('click', () => this.previewTyping(ui));
        ui.note.querySelector('.typing-profile-reset').addEventListener('click', () => {
            this.setTypingProfile(ui, null);
            toast('Скорость по фразам убрана: реплика печатается скоростью из поля', 'success');
        });
        // Скорость поправили руками — значит, нужна одна скорость на всю реплику.
        ui.speed.addEventListener('input', () => { if (ui.profile.value) this.setTypingProfile(ui, null); });
    }

    // Скорость по фразам ([[внутри, после], …] на каждую фразу текста) хранится вместе с тем,
    // для какого текста и записи её посчитали: поменяли их — профиль больше не годится.
    setTypingProfile(ui, profile, summary = '') {
        const list = parseStoredProfile(profile);
        ui.profile.value = list ? JSON.stringify(list) : '';
        ui.profile.dataset.text = list ? ui.text.value : '';
        ui.profile.dataset.voiceline = list ? ui.voiceline.value : '';
        ui.profile.dataset.summary = list
            ? summary || `Скорость по фразам из «Авто»: ${list.length} ${plural(list.length, 'фраза', 'фразы', 'фраз')} текста. Поле скорости — запасное.`
            : '';
        this.refreshTypingProfile(ui);
    }

    // Профиль для сохранения: null, если его нет или текст / озвучка с тех пор изменились.
    typingProfileOf(ui) {
        if (!ui.profile.value) return null;
        if (ui.profile.dataset.text !== ui.text.value || ui.profile.dataset.voiceline !== ui.voiceline.value) return null;
        return parseStoredProfile(ui.profile.value);
    }

    refreshTypingProfile(ui) {
        const stored = !!ui.profile.value;
        const valid = !!this.typingProfileOf(ui);
        ui.note.hidden = !stored;
        ui.note.classList.toggle('is-stale', stored && !valid);
        if (!stored) return;
        ui.note.querySelector('.typing-profile-text').textContent = valid
            ? ui.profile.dataset.summary
            : 'Текст или озвучка изменились — скорость по фразам не сохранится. Нажмите «Авто» ещё раз или оставьте одну скорость.';
    }

    // «Авто» (шаги A–C). Запись декодируется целиком (voice-analysis.js): точная длина, границы речи
    // и паузы внутри неё. Тишина в начале уходит в «голос с … мс» — терминал ждёт её. Фразы текста
    // сопоставляются с участками речи, и у каждой своя скорость (typing-text.js, planTyping);
    // в поле скорости — одна скорость на всю речь: её терминал берёт, если фраз не получилось.
    // Текст — как его напечатает терминал: паузы [Ns] и добавки за знаки препинания вычитаются,
    // разметка и маркеры помех — не символы, метки пилота — имя тестового пилота этого сословия.
    autoCalculateTypingSpeed(ui = this.typingUi()) {
        const voicelinePath = ui.voiceline.value;
        if (!voicelinePath) return toast('Сначала выберите файл озвучки', 'error');
        const pilot = PREVIEW_PILOTS[ui.audience] || PREVIEW_PILOTS.lancer;
        const text = applyTokens(ui.text.value, tokenValues(pilot));
        if (!text.trim()) return toast('Сначала введите текст реплики', 'error');

        return withBusy(ui.auto, async () => {
            let voice;
            let approximate = false;
            try {
                voice = await analyzeVoice(assetUrl(voicelinePath));
            } catch (error) {
                // Формат, который браузер играет, но не декодирует целиком, — по заголовку файла, без обрезки тишины.
                debug('Анализ озвучки не удался, длительность по заголовку:', error);
                const duration = await this.mediaDuration(assetUrl(voicelinePath));
                if (!duration) return toast('Не удалось загрузить аудиофайл для расчёта', 'error');
                voice = { duration, start: 0, end: duration, speech: duration, leadSilence: 0, tailSilence: 0,
                    segments: [{ start: 0, end: duration }], silent: true };
                approximate = true;
            }

            const plan = planTyping(text, voice);
            if (plan.error) return toast(plan.error, 'error');
            ui.speed.value = plan.speed;
            const offset = Math.round(voice.leadSilence * 1000);
            ui.offset.value = offset;

            const byPhrases = Array.isArray(plan.phraseProfile) && plan.phraseProfile.length > 0;
            const sec = v => `${v.toFixed(1)} с`;
            const parts = [];
            if (approximate) parts.push(`запись не разобрана, длина по заголовку ${sec(voice.duration)}`);
            else if (voice.silent) parts.push(`голос в записи не найден, взята вся длина ${sec(voice.duration)}`);
            else parts.push(`речь ${sec(voice.speech)} из ${sec(voice.duration)} (тишина: в начале ${sec(voice.leadSilence)}, в конце ${sec(voice.tailSilence)})`);

            let summary = '';
            if (byPhrases) {
                const speeds = plan.phraseProfile.map(p => p[0]);
                const range = `${Math.min(...speeds)}–${Math.max(...speeds)} мс/символ`;
                summary = `Скорость по фразам: ${plan.phrases} ${plural(plan.phrases, 'отрезок', 'отрезка', 'отрезков')} речи `
                    + `на ${plan.phrasesInText} ${plural(plan.phrasesInText, 'фразу', 'фразы', 'фраз')} текста, ${range}. `
                    + `Поле скорости — запасное: им печатается, если текст поменяют.`;
                parts.push(`по фразам — ${plan.phrases} ${plural(plan.phrases, 'отрезок', 'отрезка', 'отрезков')} (в записи ${plan.speechParts}, в тексте ${plan.phrasesInText}), ${range}`);
            } else if (!approximate && !voice.silent) {
                parts.push(plan.phrasesInText < 2 ? 'одна скорость: в тексте одна фраза' : 'одна скорость: в записи нет пауз между фразами');
            }
            this.setTypingProfile(ui, byPhrases ? plan.phraseProfile : null, summary);

            const waits = [];
            if (plan.pauseSec > 0) waits.push(`паузы [Ns] ${sec(plan.pauseSec)}`);
            if (plan.punctSec > 0) waits.push(`знаки препинания ${sec(plan.punctSec)}`);
            if (waits.length) parts.push(`учтены ${waits.join(' и ')}`);
            if (hasTokens(ui.text.value)) parts.push(`метки пилота — как у ${pilot.callsign}`);
            toast(`${byPhrases ? 'Запасная скорость' : 'Скорость'} ${plan.speed} мс/символ, голос с ${offset} мс: ${parts.join('; ')}`, 'success');
        });
    }

    // «Проверить»: реплика печатается вместе с озвучкой по тем же правилам, что в терминале
    // (средние задержки, без случайностей и эффектов разметки). Повторное нажатие — стоп.
    previewTyping(ui) {
        const same = this.typingPreview?.box === ui.preview;
        this.stopTypingPreview();
        if (same) return;

        const pilot = PREVIEW_PILOTS[ui.audience] || PREVIEW_PILOTS.lancer;
        const text = applyTokens(ui.text.value, tokenValues(pilot));
        if (!text.trim()) return toast('Сначала введите текст реплики', 'error');
        const { segments, times } = typingTimeline(text, {
            speed: parseFloat(ui.speed.value) || 0,
            phraseProfile: this.typingProfileOf(ui)
        });
        const offset = parseInt(ui.offset.value, 10) || 0;
        const path = ui.voiceline.value;
        const audio = path ? new Audio(assetUrl(path)) : null;

        const box = ui.preview;
        const shown = document.createTextNode('');
        const cursor = document.createElement('span');
        cursor.className = 'typing-preview-cursor';
        box.replaceChildren(shown, cursor);
        box.hidden = false;
        ui.check.textContent = 'Стоп';

        const preview = { box, button: ui.check, audio, raf: 0, startAt: null };
        this.typingPreview = preview;
        let printed = -1;
        const tick = () => {
            if (this.typingPreview !== preview) return;
            if (preview.startAt !== null) {
                const elapsed = performance.now() - preview.startAt;
                let k = Math.max(printed, 0);
                while (k < times.length && times[k] <= elapsed) k++;
                if (k !== printed) {
                    printed = k;
                    shown.data = segments.slice(0, k).map(s => s.char).join('');
                }
                if (k >= times.length && (!audio || audio.ended || audio.paused)) {
                    this.stopTypingPreview();
                    return;
                }
            }
            preview.raf = requestAnimationFrame(tick);
        };

        if (audio) {
            // Отсчёт — от фактического начала звука, как в терминале.
            audio.addEventListener('playing', () => {
                if (preview.startAt === null) preview.startAt = performance.now() - audio.currentTime * 1000 + offset;
            }, { once: true });
            audio.play().catch(() => {
                if (this.typingPreview !== preview) return;
                preview.startAt = performance.now();
                toast('Озвучка не запустилась — печать без звука', 'error');
            });
        } else {
            preview.startAt = performance.now();
        }
        tick();
    }

    stopTypingPreview() {
        const preview = this.typingPreview;
        if (!preview) return;
        this.typingPreview = null;
        cancelAnimationFrame(preview.raf);
        if (preview.audio) preview.audio.pause();
        preview.button.textContent = 'Проверить';
        preview.box.querySelector('.typing-preview-cursor')?.remove();
    }

    // Длительность по заголовку файла — запасной путь, если запись не декодируется.
    mediaDuration(url) {
        return new Promise(resolve => {
            const audio = new Audio(url);
            audio.addEventListener('loadedmetadata', () => resolve(isFinite(audio.duration) ? audio.duration : 0));
            audio.addEventListener('error', () => resolve(0));
            audio.load();
        });
    }

    // targetSelect — список озвучки, в котором выбрать загруженный файл (по умолчанию основной).
    async uploadFile(event, kind, targetSelect = null) {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        try {
            const data = await store.uploadFile(kind, file);
            if (kind === 'sound') {
                this.fillSoundSelect();
                this.el('character-voice').value = data.path;
            } else {
                // Список озвучки общий: обновляем все поля, сохраняя выбранное.
                const selects = [this.el('conversation-voiceline'),
                    ...document.querySelectorAll('#variant-fields .variant-voiceline')];
                selects.forEach(sel => {
                    const keep = sel.value;
                    sel.innerHTML = this.voicelineOptions();
                    selectValue(sel, keep);
                });
                (targetSelect || this.el('conversation-voiceline')).value = data.path;
                this.updateConversationHints();
            }
            toast('Файл загружен', 'success');
        } catch (error) {
            toast(`Ошибка загрузки файла: ${error.message}`, 'error');
        }
    }

    // ===================== события =====================

    initEventListeners() {
        const on = (id, event, fn) => this.el(id).addEventListener(event, fn);
        const hide = id => () => { this.el(id).style.display = 'none'; };

        on('new-dialogue-btn', 'click', () => {
            this.el('new-dialogue-modal').style.display = 'flex';
            this.el('new-dialogue-frequency').focus();
        });
        on('cancel-new-dialogue', 'click', hide('new-dialogue-modal'));
        on('create-dialogue-btn', 'click', e => withBusy(e.currentTarget, () => this.createDialogue()));
        on('save-dialogue-btn', 'click', e => withBusy(e.currentTarget, () => this.saveDialogue()));
        on('delete-dialogue-btn', 'click', () => this.deleteDialogue());
        on('dialogue-access', 'change', e => {
            const custom = e.target.value === 'custom';
            this.el('users-selector').classList.toggle('hidden', !custom);
            if (!custom) this.state.selectedAllowedUsers = [];
        });

        on('add-character-btn', 'click', () => this.openCharacterModal());
        on('cancel-character', 'click', hide('character-modal'));
        on('save-character-btn', 'click', e => withBusy(e.currentTarget, () => this.saveCharacter()));
        on('character-voice-mode', 'change', e => this.updateVoiceModeUI(e.target.value));
        on('preview-typing-btn', 'click', () => this.previewSound('character-voice'));
        on('upload-voice-btn', 'click', () => this.el('upload-voice').click());
        on('upload-voice', 'change', e => this.uploadFile(e, 'sound'));

        on('add-conversation-btn', 'click', () => this.openConversation());
        on('cancel-conversation', 'click', () => this.closeConversation());
        on('save-conversation-btn', 'click', e => withBusy(e.currentTarget, () => this.saveConversation()));
        on('conversation-open-character', 'click', () => {
            const char = this.state.characters.find(c => String(c.id) === this.el('conversation-character').value);
            if (char?.global_character_id) this.studio.openCharacter(char.global_character_id);
            else toast('Сначала выберите персонажа', 'error');
        });
        on('has-choice', 'change', e => this.el('choice-options-container').classList.toggle('hidden', !e.target.checked));
        on('add-choice-option-btn', 'click', () => this.addChoiceOption());
        on('preview-conversation-voiceline-btn', 'click', () => this.previewSound('conversation-voiceline'));
        on('upload-conversation-voiceline-btn', 'click', () => this.el('upload-conversation-voiceline').click());
        on('upload-conversation-voiceline', 'change', e => this.uploadFile(e, 'voiceline'));
        this.bindTypingControls(this.typingUi());

        // Варианты для сословий и метки пилота
        on('has-variant', 'change', e => {
            this.el('variant-fields').hidden = !e.target.checked;
            // Включили впервые — сразу включаем вариант для Кавалера, остальное по желанию.
            if (e.target.checked && !this.enabledVariantBlocks().length) {
                const first = this.variantBlocks?.cavalier?.querySelector('.variant-enabled');
                if (first) { first.checked = true; first.dispatchEvent(new Event('change')); }
            }
            this.updateConversationHints();
        });
        document.querySelectorAll('.token-bar .token-btn').forEach(btn => {
            // mousedown + preventDefault: поле не теряет фокус и позицию курсора.
            btn.addEventListener('mousedown', e => e.preventDefault());
            btn.addEventListener('click', () => this.insertToken(btn.dataset.token));
        });
        // Метки вставляются в последнее поле с [data-token-target], где стоял курсор
        // (основной текст, варианты для сословий, тексты ответов).
        const modalBody = this.el('conversation-modal');
        ['focusin', 'pointerdown', 'keyup'].forEach(type => modalBody.addEventListener(type, e => {
            if (e.target.matches?.('[data-token-target]')) this.lastTokenTarget = e.target;
        }));
        modalBody.addEventListener('input', e => {
            if (e.target.matches?.('[data-token-target]')) this.updateConversationHints();
        });
        ['conversation-character', 'conversation-voiceline'].forEach(id =>
            on(id, 'change', () => this.updateConversationHints()));

        // Сводка диалога обновляется сразу; открыт ли блок — запоминается.
        ['dialogue-frequency', 'dialogue-title', 'dialogue-max-repeats'].forEach(id => on(id, 'input', () => this.renderInfoSummary()));
        ['dialogue-active', 'dialogue-access'].forEach(id => on(id, 'change', () => this.renderInfoSummary()));
        const info = this.el('dialogue-info');
        try { if (localStorage.getItem(INFO_OPEN_KEY) === '0') info.open = false; } catch { /* хранилище недоступно */ }
        info.addEventListener('toggle', () => {
            try { localStorage.setItem(INFO_OPEN_KEY, info.open ? '1' : '0'); } catch { /* хранилище недоступно */ }
        });

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
        });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; });
        });
    }
}
