// Раздел студии «Диалоги»: список слева, сведения, персонажи и дерево в центре,
// редактор реплики — в правой колонке (раньше был модальным окном).
import api from '../admin/admin-api.js';
import { toast, withBusy } from '../admin/admin-shell.js';
import debug from '../debug.js';
import { escapeHtml, escapeAttr } from '../escape-utils.js';
import { readPortrait, portraitCss } from '../portrait-frame.js';
import DialogueTreeVisualizer from './dialogue-tree-visualizer.js';
import { TOKENS, hasTokens, prepareConversation } from '../pilot-tokens.js';
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

// Пилоты для предпросмотра: как реплику увидит Кавалер в Доме и Лансер.
const PREVIEW_PILOTS = {
    cavalier: { callsign: 'RAVEN', full_name: 'леди Кассия-Вейл из Дома Стекла', gender: 'female', estate: 'cavalier', house_standing: 'member', house_key: 'glass' },
    lancer: { callsign: 'HAMMER', full_name: 'Тара Окс', gender: 'neutral', estate: 'lancer', house_standing: 'member' }
};
// Поля, куда вставляются метки кнопками над текстом.
const TOKEN_TARGETS = ['conversation-text', 'variant-text', 'conversation-fake-name', 'variant-fake-name'];
// Разметка терминала ([1s], [Shake]…[ShakeE]) в предпросмотре не нужна.
const stripMarkup = text => String(text || '').replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();

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
        this.treeVisualizer.on('nodeClick', node => this.showSpeaker(node.conversationId));
        this.treeVisualizer.on('nodeEdit', node => this.openConversation(node.conversationId));
        this.treeVisualizer.on('nodeDelete', node => this.deleteConversation(node.conversationId));
        this.treeVisualizer.on('nodeAdd', afterNode => this.addConversationAfter(afterNode));
        this.treeVisualizer.on('nodeAddBefore', beforeNode => this.addConversationBefore(beforeNode));
        this.treeVisualizer.on('nodeUnlink', node => this.unlinkConversation(node));
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
        this.el('dialogue-summary').textContent = `${dialogue.frequency} · ${dialogue.title || 'Без названия'}`;

        let allowedUsers = [-1];
        try { allowedUsers = JSON.parse(dialogue.allowed_users || '[-1]'); } catch { /* старый формат */ }
        const isAllUsers = allowedUsers.includes(-1);
        this.el('dialogue-access').value = isAllUsers ? 'all' : 'custom';
        this.state.selectedAllowedUsers = isAllUsers ? [] : allowedUsers;
        this.el('dialogue-active').checked = dialogue.is_active !== 0;
        this.el('dialogue-max-repeats').value = dialogue.max_repeats !== undefined ? dialogue.max_repeats : 1;

        this.updateUsersSelector();
        this.el('users-selector').classList.toggle('hidden', isAllUsers);
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
            characters: this.state.characters
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

    async unlinkConversation(node) {
        if (!node || !confirm('Отсоединить реплику? Она будет перемещена в отдельную ветку.')) return;
        try {
            await api.conversations.unlink({ conversationId: node.conversationId });
            await this.reload();
        } catch (error) {
            toast(error.message || 'Ошибка отсоединения', 'error');
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

    // Одиночный клик по реплике: в правой колонке — кто говорит, со ссылкой в каталог.
    showSpeaker(conversationId) {
        if (!this.el('conversation-panel').hidden) return;
        const conv = this.state.conversations.find(c => String(c.id) === String(conversationId));
        const char = conv && this.state.characters.find(c => String(c.id) === String(conv.character_id));
        const host = this.el('conv-speaker-card');
        host.textContent = '';
        if (!char) return;
        const card = document.createElement('div');
        card.className = 'speaker-card';
        const name = document.createElement('b');
        name.textContent = this.characterName(char);
        const text = document.createElement('p');
        text.textContent = conv.text;
        const open = document.createElement('button');
        open.className = 'btn btn-small';
        open.textContent = 'Редактировать реплику';
        open.addEventListener('click', () => this.openConversation(conv.id));
        card.append(name, text, open);
        if (char.global_character_id) {
            const toCatalog = document.createElement('button');
            toCatalog.className = 'btn btn-small';
            toCatalog.textContent = 'Персонаж в каталоге';
            toCatalog.addEventListener('click', () => this.studio.openCharacter(char.global_character_id));
            card.appendChild(toCatalog);
        }
        host.appendChild(card);
    }

    // ===================== редактор реплики (правая колонка) =====================

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

        this.el('conversation-panel-title').textContent = conv ? 'РЕПЛИКА' : 'НОВАЯ РЕПЛИКА';
        this.el('conversation-id').value = conv ? conv.id : '';
        this.el('conversation-character').value = conv ? conv.character_id : '';
        this.el('conversation-branch-select').value = conv ? conv.branch_id : defaultBranch;
        this.el('conversation-text').value = conv ? conv.text : '';
        selectValue(this.el('conversation-custom-image'), conv?.custom_image);
        this.el('conversation-fake-name').value = conv?.fake_name || '';
        selectValue(this.el('conversation-voiceline'), conv?.voiceline);
        this.el('conversation-typing-speed').value = conv?.typing_speed || 0;
        this.el('conversation-forced-sort').value = !conv && forcedSortOrder !== null ? forcedSortOrder : '';

        this.fillVariantFields(conv);

        const choices = conv ? this.state.choices.filter(ch => String(ch.conversation_id) === String(conv.id)) : [];
        this.el('has-choice').checked = choices.length > 0;
        this.el('choice-options-container').classList.toggle('hidden', choices.length === 0);
        this.el('choice-id').value = choices.length ? choices[0].choice_id : '';
        this.el('choice-options-list').textContent = '';
        if (choices.length) this.renderChoiceOptions(choices);

        this.el('conv-placeholder').hidden = true;
        this.el('conversation-panel').hidden = false;
        this.el('conversation-panel').closest('.studio-col').scrollTop = 0;
        if (conv) this.treeVisualizer.highlightNode?.(conv.id);
        this.lastTokenTarget = this.el('conversation-text');
        this.updateConversationHints();
        this.el('conversation-text').focus();
    }

    // ===================== вариант для сословия и метки пилота =====================

    variantOf(conversationId) {
        return this.state.variants.find(v => String(v.conversation_id) === String(conversationId)) || null;
    }

    fillVariantFields(conv) {
        const variant = conv ? this.variantOf(conv.id) : null;
        this.el('variant-voiceline').innerHTML = option('', 'Без озвучки (звук персонажа)') +
            store.files.voicelines.map(v => option(v, fileName(v))).join('');
        this.el('variant-custom-image').innerHTML = option('', 'Как у основной реплики') +
            store.files.portraits.map(p => option(p, fileName(p))).join('');

        this.el('has-variant').checked = !!variant;
        this.el('variant-fields').hidden = !variant;
        this.el('variant-audience').value = variant?.audience || 'lancer';
        this.el('variant-text').value = variant?.text || '';
        selectValue(this.el('variant-voiceline'), variant?.voiceline);
        this.el('variant-fake-name').value = variant?.fake_name || '';
        selectValue(this.el('variant-custom-image'), variant?.custom_image);
        this.el('variant-typing-speed').value = variant?.typing_speed || 0;
        this.updateVariantAudienceHelp();
    }

    updateVariantAudienceHelp() {
        const audience = this.el('variant-audience').value;
        this.el('variant-audience-help').textContent = audience === 'lancer'
            ? 'Основной текст выше услышит Кавалер в Доме.'
            : 'Основной текст выше услышат Лансер и Кавалер-изгнанник.';
    }

    // Реплика из формы в формате терминала — для предпросмотра.
    formConversation() {
        const char = this.state.characters.find(c => String(c.id) === this.el('conversation-character').value);
        const conv = {
            speaker: char ? this.characterName(char) : 'Персонаж',
            text: this.el('conversation-text').value,
            fakeName: this.el('conversation-fake-name').value
        };
        if (this.el('has-variant').checked && this.el('variant-text').value.trim()) {
            conv.variants = {
                [this.el('variant-audience').value]: {
                    text: this.el('variant-text').value,
                    fakeName: this.el('variant-fake-name').value
                }
            };
        }
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
        warn('conversation-token-warning', `${this.el('conversation-text').value} ${this.el('conversation-fake-name').value}`);
        warn('variant-token-warning', `${this.el('variant-text').value} ${this.el('variant-fake-name').value}`);

        this.el('conversation-voice-hint').hidden = !(this.el('conversation-voiceline').value && hasTokens(this.el('conversation-text').value));
        this.el('variant-voice-hint').hidden = !(this.el('variant-voiceline').value && hasTokens(this.el('variant-text').value));

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
        const target = TOKEN_TARGETS.includes(active?.id) ? active : (this.lastTokenTarget || this.el('conversation-text'));
        const text = `<${token}>`;
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        target.value = target.value.slice(0, start) + text + target.value.slice(end);
        target.focus();
        target.setSelectionRange(start + text.length, start + text.length);
        this.updateConversationHints();
    }

    // Сохранение варианта после основной реплики. false — сохранение прервано.
    async saveVariant(conversationId) {
        const existing = this.variantOf(conversationId);
        const wanted = this.el('has-variant').checked;
        const audience = this.el('variant-audience').value;

        if (!wanted) {
            if (existing) await api.conversations.removeVariant(conversationId, existing.audience);
            return true;
        }
        // Сменили аудиторию — старый вариант убираем, чтобы не осталось двух.
        if (existing && existing.audience !== audience) {
            await api.conversations.removeVariant(conversationId, existing.audience);
        }
        await api.conversations.saveVariant(conversationId, audience, {
            text: this.el('variant-text').value.trim(),
            voiceline: this.el('variant-voiceline').value,
            fakeName: this.el('variant-fake-name').value.trim(),
            customImage: this.el('variant-custom-image').value,
            typingSpeed: parseFloat(this.el('variant-typing-speed').value) || 0
        });
        return true;
    }

    closeConversation() {
        this.el('conversation-panel').hidden = true;
        this.el('conv-placeholder').hidden = false;
        this.el('conv-speaker-card').textContent = '';
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
        choices.forEach(ch => {
            const hasRelation = ch.relation_global_char_id !== null && ch.relation_global_char_id !== undefined;
            const relationData = hasRelation ? {
                globalCharId: ch.relation_global_char_id,
                min: ch.relation_require_min !== null ? ch.relation_require_min : -100,
                max: ch.relation_require_max !== null ? ch.relation_require_max : 100,
                effect: ch.relation_effect || 0
            } : null;
            this.addChoiceOption(ch.option_id, ch.option_text, ch.target_branch, ch.id, relationData);
        });
    }

    addChoiceOption(id = '', text = '', target = '', dbId = null, relationData = null) {
        const container = this.el('choice-options-list');
        const fragment = this.el('choice-option-template').content.cloneNode(true);
        const optionDiv = fragment.querySelector('.choice-option');
        optionDiv.dataset.optionId = id || Date.now();
        if (dbId) optionDiv.dataset.dbId = dbId;

        optionDiv.querySelector('.option-text').value = text;

        const targetSelect = optionDiv.querySelector('.option-target');
        targetSelect.innerHTML = option('', 'Новая ветка') + this.state.branches.map(b => option(b.branch_id, b.branch_id)).join('');
        targetSelect.value = target || '';

        const characterSelect = optionDiv.querySelector('.option-character');
        characterSelect.innerHTML = option('', 'Выберите персонажа') +
            this.state.characters.map(c => option(c.id, this.characterName(c))).join('');
        characterSelect.classList.toggle('hidden', !!target);
        targetSelect.addEventListener('change', e => characterSelect.classList.toggle('hidden', e.target.value !== ''));

        const npcLabel = optionDiv.querySelector('.relation-npc-name');
        const updateNpcLabel = () => {
            const selChar = this.state.characters.find(c => String(c.id) === this.el('conversation-character').value);
            npcLabel.textContent = selChar ? `Персонаж: ${this.characterName(selChar)}` : 'Персонаж: не выбран';
        };
        this.el('conversation-character').addEventListener('change', updateNpcLabel);
        updateNpcLabel();

        const relationSection = optionDiv.querySelector('.choice-option-relation');
        const icon = relationSection.querySelector('.relation-toggle-icon');
        const header = relationSection.querySelector('.relation-header');
        const setExpanded = expanded => {
            relationSection.classList.toggle('expanded', expanded);
            icon.textContent = expanded ? '▼' : '▶';
            header.setAttribute('aria-expanded', String(expanded));
        };
        if (relationData) {
            optionDiv.querySelector('.relation-min').value = relationData.min;
            optionDiv.querySelector('.relation-max').value = relationData.max;
            optionDiv.querySelector('.relation-effect').value = relationData.effect;
            if (relationData.globalCharId) setExpanded(true);
        }
        header.addEventListener('click', () => {
            setExpanded(!relationSection.classList.contains('expanded'));
            updateNpcLabel();
        });

        optionDiv.querySelector('.remove-option-btn').addEventListener('click', () => optionDiv.remove());
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
        const hasChoice = this.el('has-choice').checked;

        if (!characterId || !text) {
            toast('Выберите персонажа и введите текст', 'error');
            return;
        }
        if (this.el('has-variant').checked && !this.el('variant-text').value.trim()) {
            toast('Введите текст варианта или снимите галочку «Альтернативная реплика»', 'error');
            this.el('variant-text').focus();
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

        const fields = { branchId, characterId, text, customImage, fakeName, voiceline, typingSpeed, sortOrder };
        try {
            let conversationId = id;
            if (id) {
                await api.conversations.update(id, fields);
            } else {
                const data = await api.conversations.create({ dialogueId: this.state.currentDialogueId, ...fields });
                conversationId = data.conversationId;
            }
            if (hasChoice && !(await this.saveChoices(conversationId))) return;
            await this.saveVariant(conversationId);

            toast('Реплика сохранена', 'success');
            await this.reload();
            this.openConversation(conversationId);
        } catch (error) {
            toast(`Ошибка сохранения реплики: ${error.message}`, 'error');
        }
    }

    // Возвращает false, если сохранение прервано (не выбран персонаж для новой ветки и т. п.).
    async saveChoices(conversationId) {
        const choiceId = this.el('choice-id').value || `choice_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const convCharacter = this.state.characters.find(c => String(c.id) === this.el('conversation-character').value);

        const options = [...this.el('choice-options-list').querySelectorAll('.choice-option')].map((opt, i) => {
            const targetBranch = opt.querySelector('.option-target').value;
            const min = parseInt(opt.querySelector('.relation-min').value);
            const max = parseInt(opt.querySelector('.relation-max').value);
            const effect = parseInt(opt.querySelector('.relation-effect').value) || 0;
            const hasRelation = min !== -100 || max !== 100 || effect !== 0;
            return {
                dbId: opt.dataset.dbId || null,
                optionId: opt.dataset.optionId || `opt_${i}_${Date.now()}`,
                optionText: opt.querySelector('.option-text').value,
                targetBranch,
                characterId: opt.querySelector('.option-character').value,
                isNewBranch: !targetBranch,
                sortOrder: i,
                // Отношение меняется с персонажем, который говорит эту реплику.
                relationGlobalCharId: hasRelation && convCharacter?.global_character_id ? convCharacter.global_character_id : null,
                relationRequireMin: Number.isFinite(min) ? min : -100,
                relationRequireMax: Number.isFinite(max) ? max : 100,
                relationEffect: effect
            };
        });

        for (const opt of options) {
            if (!opt.optionText) continue;

            if (opt.isNewBranch) {
                if (!opt.characterId) {
                    toast(`Выберите персонажа для варианта «${opt.optionText}» или укажите существующую ветку`, 'error');
                    return false;
                }
                try {
                    await api.branches.createWithConversation({
                        dialogueId: this.state.currentDialogueId,
                        branchId: `branch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                        characterId: opt.characterId,
                        conversationId,
                        choiceId,
                        optionId: opt.optionId,
                        optionText: opt.optionText,
                        sortOrder: opt.sortOrder
                    });
                } catch (error) {
                    toast(error.message || 'Ошибка создания ветки', 'error');
                    return false;
                }
                continue;
            }

            const payload = {
                conversationId,
                choiceId,
                optionId: opt.optionId,
                optionText: opt.optionText,
                targetBranch: opt.targetBranch,
                sortOrder: opt.sortOrder,
                relationGlobalCharId: opt.relationGlobalCharId,
                relationRequireMin: opt.relationRequireMin,
                relationRequireMax: opt.relationRequireMax,
                relationEffect: opt.relationEffect
            };
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
            this.el('dialogue-summary').textContent = `${body.frequency} · ${body.title || 'Без названия'}`;
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

    previewSound(selectId) {
        const path = this.el(selectId).value;
        if (!path) return;
        this.state.audioPreview?.pause();
        this.state.audioPreview = new Audio(assetUrl(path));
        this.state.audioPreview.play().catch(err => debug('Audio play error:', err));
    }

    autoCalculateTypingSpeed(prefix = 'conversation') {
        const voicelinePath = this.el(`${prefix}-voiceline`).value;
        const text = this.el(`${prefix}-text`).value;
        if (!voicelinePath) return toast('Сначала выберите файл озвучки', 'error');
        const charCount = text.replace(/\[\d+\.?\d*s\]/g, '').trim().length;
        if (!charCount) return toast('Сначала введите текст реплики', 'error');

        const audio = new Audio(assetUrl(voicelinePath));
        audio.addEventListener('loadedmetadata', () => {
            if (!(audio.duration > 0) || !isFinite(audio.duration)) {
                toast('Не удалось получить длительность аудиофайла', 'error');
                return;
            }
            this.el(`${prefix}-typing-speed`).value = Math.round(audio.duration * 1000 / charCount);
        });
        audio.addEventListener('error', () => toast('Не удалось загрузить аудиофайл для расчёта', 'error'));
        audio.load();
    }

    async uploadFile(event, kind, target = 'conversation') {
        const file = event.target.files[0];
        event.target.value = '';
        if (!file) return;
        try {
            const data = await store.uploadFile(kind, file);
            if (kind === 'sound') {
                this.fillSoundSelect();
                this.el('character-voice').value = data.path;
            } else {
                // Список озвучки общий: обновляем оба поля, выбираем файл в том, откуда загружали.
                const variantValue = this.el('variant-voiceline').value;
                this.fillVoicelineSelect();
                this.el('variant-voiceline').innerHTML = option('', 'Без озвучки (звук персонажа)') +
                    store.files.voicelines.map(v => option(v, fileName(v))).join('');
                this.el('variant-voiceline').value = variantValue;
                this.el(target === 'variant' ? 'variant-voiceline' : 'conversation-voiceline').value = data.path;
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
        on('auto-calc-speed-btn', 'click', () => this.autoCalculateTypingSpeed());

        // Вариант для сословия и метки пилота
        on('has-variant', 'change', e => {
            this.el('variant-fields').hidden = !e.target.checked;
            if (e.target.checked) this.el('variant-text').focus();
            this.updateConversationHints();
        });
        on('variant-audience', 'change', () => { this.updateVariantAudienceHelp(); this.updateConversationHints(); });
        on('preview-variant-voiceline-btn', 'click', () => this.previewSound('variant-voiceline'));
        on('upload-variant-voiceline-btn', 'click', () => this.el('upload-variant-voiceline').click());
        on('upload-variant-voiceline', 'change', e => this.uploadFile(e, 'voiceline', 'variant'));
        on('variant-auto-speed-btn', 'click', () => this.autoCalculateTypingSpeed('variant'));
        document.querySelectorAll('.token-bar .token-btn').forEach(btn => {
            // mousedown + preventDefault: поле не теряет фокус и позицию курсора.
            btn.addEventListener('mousedown', e => e.preventDefault());
            btn.addEventListener('click', () => this.insertToken(btn.dataset.token));
        });
        TOKEN_TARGETS.forEach(id => {
            ['focus', 'pointerdown', 'keyup'].forEach(type => on(id, type, () => { this.lastTokenTarget = this.el(id); }));
            on(id, 'input', () => this.updateConversationHints());
        });
        ['conversation-character', 'conversation-voiceline', 'variant-voiceline'].forEach(id =>
            on(id, 'change', () => this.updateConversationHints()));

        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
        });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            document.querySelectorAll('.modal').forEach(m => { m.style.display = 'none'; });
        });
    }
}
