import AppConfig from '../config.js';
import DialogueTreeVisualizer from './dialogue-tree-visualizer.js';

const { API_URL, ASSETS_URL } = AppConfig;

function getAssetUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    
    if (ASSETS_URL && !ASSETS_URL.includes('DOMENHERE')) {
        if (path.startsWith('/assets/')) return ASSETS_URL.replace('/assets', '') + path;
        if (path.startsWith('assets/')) return ASSETS_URL + path.replace('assets/', '/');
    }
    
    return path;
}

class DialogueEditor {
 constructor() {
        this.state = {
            currentDialogueId: null,
            dialogues: [],
            characters: [],
            branches: [],
            conversations: [],
            choices: [],
            portraits: [],
            sounds: [],
            voicelines: [],
            users: [],
            selectedAllowedUsers: [],
            selectedNodeId: null,
            audioPreview: null
        };
        this.treeVisualizer = null;
    }
    
async init() {
        try {
            await this.checkAuth();
            await this.loadDialogues();
            await this.loadFiles();
            await this.loadUsers();
            this.initTreeVisualizer();
            this.initEventListeners();
            this.generateBackgroundCode();
        } catch (error) {
            console.error('Init error:', error);
            alert('Ошибка загрузки');
        }
    }
    
    initTreeVisualizer() {
        this.treeVisualizer = new DialogueTreeVisualizer('dialogue-tree-container', {
            nodeWidth: 200,
            nodeHeight: 80,
            rankSeparation: 120,
            nodeSeparation: 70
        });
        
        this.treeVisualizer.on('nodeClick', (nodeData) => {
            this.state.selectedNodeId = nodeData.conversationId;
        });
        
        this.treeVisualizer.on('nodeEdit', (nodeData) => {
            this.openConversationModal(nodeData.conversationId);
        });
        
        this.treeVisualizer.on('nodeDelete', (nodeData) => {
            if (confirm('Удалить эту реплику?')) {
                this.deleteConversation(nodeData.conversationId);
            }
        });
        
        this.treeVisualizer.on('nodeAdd', (afterNode, position) => {
            this.addConversationAfter(afterNode, position);
        });
        
        this.treeVisualizer.on('connectionCreate', (fromNode, toNode) => {
            this.createChoiceConnection(fromNode, toNode);
        });
    }
    
    async checkAuth() {
        const response = await fetch(`${API_URL}/admin/check`, { credentials: 'include' });
        const data = await response.json();
        if (!data.isAdmin) {
            window.location.href = 'login.html';
        }
    }
    
    async loadDialogues() {
        const response = await fetch(`${API_URL}/editor/dialogues`, { credentials: 'include' });
        const data = await response.json();
        this.state.dialogues = data.dialogues || [];
        this.renderDialogueList();
    }
    
async loadFiles() {
        try {
            const [portraitsRes, soundsRes, voicelinesRes] = await Promise.all([
                fetch(`${API_URL}/editor/files/portraits`, { credentials: 'include' }),
                fetch(`${API_URL}/editor/files/sounds`, { credentials: 'include' }),
                fetch(`${API_URL}/editor/files/voicelines`, { credentials: 'include' })
            ]);
            
            const portraitsData = await portraitsRes.json();
            const soundsData = await soundsRes.json();
            const voicelinesData = await voicelinesRes.json();
            
            this.state.portraits = portraitsData.files || [];
            this.state.sounds = soundsData.files || [];
            this.state.voicelines = voicelinesData.files || [];
        } catch (error) {
            console.error('Error loading files:', error);
        }
    }
    
    async loadUsers() {
        try {
            const response = await fetch(`${API_URL}/editor/users`, { credentials: 'include' });
            const data = await response.json();
            this.state.users = data.users || [];
        } catch (error) {
            console.error('Error loading users:', error);
            this.state.users = [];
        }
    }
    
    renderDialogueList() {
        const container = document.getElementById('dialogue-list');
        
        if (this.state.dialogues.length === 0) {
            container.innerHTML = '<div class="no-data">Нет диалогов</div>';
            return;
        }
        
        container.innerHTML = this.state.dialogues.map(d => `
            <div class="dialogue-item ${d.is_active === 0 ? 'dialogue-inactive' : ''}" data-id="${d.id}">
                <div class="dialogue-item-frequency">${d.frequency}</div>
                <div class="dialogue-item-title">${d.title || 'Без названия'}</div>
                ${d.is_active === 0 ? '<div class="dialogue-inactive-badge">Неактивен</div>' : ''}
            </div>
        `).join('');
        
        container.querySelectorAll('.dialogue-item').forEach(item => {
            item.addEventListener('click', () => this.selectDialogue(item.dataset.id));
        });
    }
    
    async selectDialogue(id) {
        document.querySelectorAll('.dialogue-item').forEach(item => {
            item.classList.toggle('active', item.dataset.id === id);
        });
        
        document.getElementById('editor-placeholder').classList.add('hidden');
        document.getElementById('editor-content').classList.remove('hidden');
        
        const response = await fetch(`${API_URL}/editor/dialogues/${id}`, { credentials: 'include' });
        const data = await response.json();
        
        this.state.currentDialogueId = id;
        this.state.characters = data.characters || [];
        this.state.branches = data.branches || [];
        this.state.conversations = data.conversations || [];
        this.state.choices = data.choices || [];
        
        this.renderDialogueInfo(data.dialogue);
        this.renderCharacters();
        this.renderDialogueTree();
        this.updateCharacterSelects();
        this.updateBranchSelects();
    }
    
renderDialogueInfo(dialogue) {
        document.getElementById('dialogue-frequency').value = dialogue.frequency;
        document.getElementById('dialogue-title').value = dialogue.title || '';
        
        const allowedUsers = JSON.parse(dialogue.allowed_users || '[-1]');
        const isAllUsers = allowedUsers.includes(-1);
        document.getElementById('dialogue-access').value = isAllUsers ? 'all' : 'custom';
        this.state.selectedAllowedUsers = isAllUsers ? [] : allowedUsers;
        
        document.getElementById('dialogue-active').checked = dialogue.is_active !== 0;
        document.getElementById('dialogue-max-repeats').value = dialogue.max_repeats !== undefined ? dialogue.max_repeats : 1;
        
        this.updateUsersSelector();
        this.toggleUsersSelector(!isAllUsers);
    }
    
    updateUsersSelector() {
        const container = document.getElementById('users-list');
        if (!container) return;
        
        container.innerHTML = this.state.users.map(user => `
            <div class="user-item">
                <input type="checkbox" id="user-${user.id}" value="${user.id}" 
                    ${this.state.selectedAllowedUsers.includes(user.id) ? 'checked' : ''}>
                <label for="user-${user.id}">${user.username} (ID: ${user.id})</label>
            </div>
        `).join('');
        
        container.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                const userId = parseInt(e.target.value);
                if (e.target.checked) {
                    if (!this.state.selectedAllowedUsers.includes(userId)) {
                        this.state.selectedAllowedUsers.push(userId);
                    }
                } else {
                    this.state.selectedAllowedUsers = this.state.selectedAllowedUsers.filter(id => id !== userId);
                }
            });
        });
    }
    
    toggleUsersSelector(show) {
        const selector = document.getElementById('users-selector');
        if (selector) {
            selector.classList.toggle('hidden', !show);
        }
    }
    
    renderCharacters() {
        const container = document.getElementById('characters-container');
        
        if (this.state.characters.length === 0) {
            container.innerHTML = '<div class="no-data">Персонажи не добавлены</div>';
            return;
        }
        
        container.innerHTML = this.state.characters.map(c => `
            <div class="character-card" data-id="${c.id}">
                <div class="character-portrait" style="background-image: url('${getAssetUrl(c.image) || getAssetUrl('assets/images/portraits/static.gif')}')"></div>
                <div class="character-info">
                    <div class="character-name">${c.name}</div>
                    <div class="character-window-label">Окно ${c.window}</div>
                </div>
                <div class="character-actions">
                    <button class="btn btn-small edit-character-btn">Редактировать</button>
                    <button class="btn btn-small btn-danger delete-character-btn">Удалить</button>
                </div>
            </div>
        `).join('');
        
        container.querySelectorAll('.character-card').forEach(card => {
            card.querySelector('.edit-character-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.openCharacterModal(card.dataset.id);
            });
            card.querySelector('.delete-character-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteCharacter(card.dataset.id);
            });
        });
    }
    
    renderDialogueTree() {
        const addConvBtn = document.getElementById('add-conversation-btn');
        const hasConversations = this.state.conversations.length > 0;
        
        if (addConvBtn) {
            addConvBtn.disabled = hasConversations;
            addConvBtn.title = hasConversations ? 'Используйте контекстное меню для добавления реплик' : '';
        }
        
        if (this.treeVisualizer) {
            this.treeVisualizer.setData({
                conversations: this.state.conversations,
                branches: this.state.branches,
                choices: this.state.choices,
                characters: this.state.characters
            });
            this.treeVisualizer.autoLayout();
        }
    }
    
    addConversationAfter(afterNode, position) {
        if (afterNode && afterNode.hasChoice) {
            alert('Нельзя добавить реплику после ячейки с выбором');
            return;
        }
        
        const branchId = afterNode ? afterNode.branchId : 'main';
        this.openConversationModal(null, branchId);
    }
    
    createChoiceConnection(fromNode, toNode) {
        if (fromNode.hasChoice) {
            alert('Нельзя создать связь от реплики с выбором');
            return;
        }
        
        if (toNode.hasChoice) {
            alert('Нельзя создать связь к реплике с выбором');
            return;
        }
        
        fetch(`${API_URL}/editor/conversations/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                fromConversationId: toNode.conversationId,
                toConversationId: fromNode.conversationId
            })
        })
        .then(res => res.json().then(data => ({ ok: res.ok, data })))
        .then(({ ok, data }) => {
            if (!ok) {
                alert(data.message || 'Ошибка создания связи');
                return;
            }
            this.selectDialogue(this.state.currentDialogueId);
        })
        .catch(err => {
            console.error('Error creating connection:', err);
            alert('Ошибка создания связи');
        });
    }
    
    updateCharacterSelects() {
        const selects = ['conversation-character', 'character-select-property'];
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;
            
            const currentValue = select.value;
            select.innerHTML = '<option value="">Выберите персонажа</option>' +
                this.state.characters.map(c => 
                    `<option value="${c.id}">${c.name}</option>`
                ).join('');
            select.value = currentValue;
        });
    }
    
updateBranchSelects() {
        const selects = ['conversation-branch-select'];
        
        selects.forEach(id => {
            const select = document.getElementById(id);
            if (!select) return;
            
            const currentValue = select.value;
            select.innerHTML = '<option value="main">Главная ветка</option>';
            
            this.state.branches.forEach(branch => {
                if (branch.branch_id !== 'main') {
                    const option = document.createElement('option');
                    option.value = branch.branch_id;
                    option.textContent = branch.branch_id;
                    select.appendChild(option);
                }
            });
            
            select.value = currentValue || 'main';
        });
    }
    
    initEventListeners() {
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        
        document.getElementById('new-dialogue-btn').addEventListener('click', () => {
            document.getElementById('new-dialogue-modal').style.display = 'flex';
        });
        
        document.getElementById('cancel-new-dialogue').addEventListener('click', () => {
            document.getElementById('new-dialogue-modal').style.display = 'none';
        });
        
        document.getElementById('create-dialogue-btn').addEventListener('click', () => this.createDialogue());
        
document.getElementById('save-dialogue-btn').addEventListener('click', () => this.saveDialogue());
        document.getElementById('delete-dialogue-btn').addEventListener('click', () => this.deleteDialogue());
        
        document.getElementById('dialogue-access').addEventListener('change', (e) => {
            const isCustom = e.target.value === 'custom';
            this.toggleUsersSelector(isCustom);
            if (!isCustom) {
                this.state.selectedAllowedUsers = [];
            }
        });
        
        document.getElementById('add-character-btn').addEventListener('click', () => this.openCharacterModal());
        
        document.getElementById('cancel-character').addEventListener('click', () => {
            document.getElementById('character-modal').style.display = 'none';
        });
        
        document.getElementById('save-character-btn').addEventListener('click', () => this.saveCharacter());
        
        document.getElementById('add-conversation-btn').addEventListener('click', () => this.openConversationModal());
        
        document.getElementById('add-branch-btn').addEventListener('click', () => {
            document.getElementById('branch-modal').style.display = 'flex';
        });
        
        document.getElementById('cancel-branch').addEventListener('click', () => {
            document.getElementById('branch-modal').style.display = 'none';
        });
        
        document.getElementById('generate-branch-id').addEventListener('click', () => {
            document.getElementById('new-branch-id').value = 
                'branch_' + Date.now().toString(36);
        });
        
        document.getElementById('create-branch-btn').addEventListener('click', () => this.createBranch());
        
        document.getElementById('cancel-conversation').addEventListener('click', () => {
            document.getElementById('conversation-modal').style.display = 'none';
        });
        
        document.getElementById('save-conversation-btn').addEventListener('click', () => this.saveConversation());
        
        document.getElementById('has-choice').addEventListener('change', (e) => {
            document.getElementById('choice-options-container').classList.toggle('hidden', !e.target.checked);
        });
        
        document.getElementById('add-choice-option-btn').addEventListener('click', () => this.addChoiceOption());
        
        document.getElementById('character-portrait').addEventListener('change', (e) => {
            const preview = document.getElementById('portrait-preview');
            preview.style.backgroundImage = e.target.value ? `url('${getAssetUrl(e.target.value)}')` : 'none';
        });
        
        document.getElementById('upload-portrait-btn').addEventListener('click', () => {
            document.getElementById('upload-portrait').click();
        });
        
        document.getElementById('upload-portrait').addEventListener('change', (e) => this.uploadFile(e, 'portrait'));
        
        document.getElementById('upload-voice-btn').addEventListener('click', () => {
            document.getElementById('upload-voice').click();
        });
        
        document.getElementById('upload-voice').addEventListener('change', (e) => this.uploadFile(e, 'sound'));
        
        document.getElementById('character-voice-mode').addEventListener('change', (e) => {
            this.updateVoiceModeUI(e.target.value);
        });
        
document.getElementById('preview-typing-btn').addEventListener('click', () => {
            this.previewSound('character-voice');
        });
        
        document.getElementById('preview-conversation-voiceline-btn').addEventListener('click', () => {
            this.previewSound('conversation-voiceline');
        });
        
        document.getElementById('upload-conversation-voiceline-btn').addEventListener('click', () => {
            document.getElementById('upload-conversation-voiceline').click();
        });
        
        document.getElementById('upload-conversation-voiceline').addEventListener('change', (e) => this.uploadFile(e, 'voiceline'));
        
        document.getElementById('auto-calc-speed-btn').addEventListener('click', () => this.autoCalculateTypingSpeed());
        
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.style.display = 'none';
            });
        });
    }
    
    async createDialogue() {
        const frequency = document.getElementById('new-dialogue-frequency').value.trim();
        const title = document.getElementById('new-dialogue-title').value.trim();
        
        if (!frequency) {
            alert('Укажите частоту');
            return;
        }
        
        try {
            const response = await fetch(`${API_URL}/editor/dialogues`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ frequency, title })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                alert(data.message);
                return;
            }
            
            document.getElementById('new-dialogue-modal').style.display = 'none';
            document.getElementById('new-dialogue-frequency').value = '';
            document.getElementById('new-dialogue-title').value = '';
            
            await this.loadDialogues();
            this.selectDialogue(data.dialogueId);
            
        } catch (error) {
            console.error('Error:', error);
            alert('Ошибка создания диалога');
        }
    }
    
async saveDialogue() {
        const frequency = document.getElementById('dialogue-frequency').value.trim();
        const title = document.getElementById('dialogue-title').value.trim();
        const access = document.getElementById('dialogue-access').value;
        const isActive = document.getElementById('dialogue-active').checked;
        const maxRepeats = parseInt(document.getElementById('dialogue-max-repeats').value) || 1;
        
        const allowedUsers = access === 'all' ? [-1] : this.state.selectedAllowedUsers;
        
        try {
            const response = await fetch(`${API_URL}/editor/dialogues/${this.state.currentDialogueId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ frequency, title, allowedUsers, isActive, maxRepeats })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                alert(data.message);
                return;
            }
            
            alert('Диалог сохранен');
            await this.loadDialogues();
            
        } catch (error) {
            console.error('Error:', error);
            alert('Ошибка сохранения');
        }
    }
    
    async deleteDialogue() {
        if (!confirm('Удалить диалог и все связанные данные?')) return;
        
        try {
            await fetch(`${API_URL}/editor/dialogues/${this.state.currentDialogueId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            this.state.currentDialogueId = null;
            document.getElementById('editor-placeholder').classList.remove('hidden');
            document.getElementById('editor-content').classList.add('hidden');
            
            await this.loadDialogues();
            
        } catch (error) {
            console.error('Error:', error);
            alert('Ошибка удаления');
        }
    }
    
openCharacterModal(id = null) {
        const modal = document.getElementById('character-modal');
        const portraitSelect = document.getElementById('character-portrait');
        const voiceSelect = document.getElementById('character-voice');
        const voiceModeSelect = document.getElementById('character-voice-mode');
        
        portraitSelect.innerHTML = '<option value="">Выберите файл...</option>' +
            this.state.portraits.map(p => `<option value="${p}">${p.split('/').pop()}</option>`).join('');
        
        voiceSelect.innerHTML = '<option value="">Выберите файл...</option>' +
            this.state.sounds.map(s => `<option value="${s}">${s.split('/').pop()}</option>`).join('');
        
        if (id) {
            const char = this.state.characters.find(c => c.id == id);
            if (char) {
                document.getElementById('character-id').value = char.id;
                document.getElementById('character-name').value = char.name;
                document.getElementById('character-window').value = char.window;
                document.getElementById('character-portrait').value = char.image || '';
                document.getElementById('character-voice').value = char.voice || '';
                document.getElementById('character-voice-mode').value = char.voice_mode || 'none';
                document.getElementById('portrait-preview').style.backgroundImage = 
                    char.image ? `url('${getAssetUrl(char.image)}')` : 'none';
                this.updateVoiceModeUI(char.voice_mode || 'none');
            }
        } else {
            document.getElementById('character-id').value = '';
            document.getElementById('character-name').value = '';
            document.getElementById('character-window').value = '1';
            document.getElementById('character-portrait').value = '';
            document.getElementById('character-voice').value = '';
            document.getElementById('character-voice-mode').value = 'none';
            document.getElementById('portrait-preview').style.backgroundImage = 'none';
            this.updateVoiceModeUI('none');
        }
        
        modal.style.display = 'flex';
    }
    
    updateVoiceModeUI(mode) {
        const typingSection = document.getElementById('voice-typing-section');
        
        typingSection.classList.add('hidden');
        
        if (mode === 'typing') {
            typingSection.classList.remove('hidden');
        }
    }
    
    previewSound(selectId) {
        const select = document.getElementById(selectId);
        const soundPath = select.value;
        
        if (!soundPath) return;
        
        if (this.state.audioPreview) {
            this.state.audioPreview.pause();
            this.state.audioPreview = null;
        }
        
        const fullUrl = getAssetUrl(soundPath);
        console.log('Playing sound:', fullUrl);
        this.state.audioPreview = new Audio(fullUrl);
        this.state.audioPreview.play().catch(err => console.log('Audio play error:', err));
    }
    
    autoCalculateTypingSpeed() {
        const voicelineSelect = document.getElementById('conversation-voiceline');
        const textArea = document.getElementById('conversation-text');
        const typingSpeedInput = document.getElementById('conversation-typing-speed');
        
        const voicelinePath = voicelineSelect.value;
        const text = textArea.value;
        
        if (!voicelinePath) {
            alert('Сначала выберите файл озвучки');
            return;
        }
        
        if (!text || text.trim().length === 0) {
            alert('Сначала введите текст реплики');
            return;
        }
        
        const cleanText = text.replace(/\[\d+\.?\d*s\]/g, '').trim();
        const charCount = cleanText.length;
        
        if (charCount === 0) {
            alert('Текст реплики пуст');
            return;
        }
        
        const fullUrl = getAssetUrl(voicelinePath);
        const audio = new Audio(fullUrl);
        
        audio.addEventListener('loadedmetadata', () => {
            const duration = audio.duration;
            
            if (duration <= 0 || !isFinite(duration)) {
                alert('Не удалось получить длительность аудиофайла');
                return;
            }
            
            const totalTypingTime = duration * 1000;
            const speedPerChar = Math.round(totalTypingTime / charCount);
            
            typingSpeedInput.value = speedPerChar;
            
            console.log(`Auto-calculated typing speed: ${speedPerChar}ms/char (${duration}s audio, ${charCount} chars)`);
        });
        
        audio.addEventListener('error', () => {
            alert('Не удалось загрузить аудиофайл для расчёта');
        });
        
        audio.load();
    }
    
async saveCharacter() {
        const id = document.getElementById('character-id').value;
        const name = document.getElementById('character-name').value.trim();
        const window = document.getElementById('character-window').value;
        const image = document.getElementById('character-portrait').value;
        const voiceMode = document.getElementById('character-voice-mode').value;
        const voice = document.getElementById('character-voice').value;
        
        if (!name) {
            alert('Укажите имя персонажа');
            return;
        }
        
        const voicePath = voiceMode === 'typing' ? voice : '';
        
        try {
            const url = id 
                ? `${API_URL}/editor/characters/${id}`
                : `${API_URL}/editor/characters`;
            const method = id ? 'PUT' : 'POST';
            
            const body = id 
                ? { name, image, voice: voicePath, voiceMode, window: parseInt(window) }
                : { dialogueId: this.state.currentDialogueId, name, image, voice: voicePath, voiceMode, window: parseInt(window) };
            
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                alert(data.message);
                return;
            }
            
            document.getElementById('character-modal').style.display = 'none';
            await this.selectDialogue(this.state.currentDialogueId);
            
        } catch (error) {
            console.error('Error:', error);
            alert('Ошибка сохранения персонажа');
        }
    }
    
    async deleteCharacter(id) {
        if (!confirm('Удалить персонажа?')) return;
        
        try {
            await fetch(`${API_URL}/editor/characters/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            await this.selectDialogue(this.state.currentDialogueId);
            
        } catch (error) {
            console.error('Error:', error);
            alert('Ошибка удаления');
        }
    }
    
openConversationModal(id = null, defaultBranch = 'main') {
        const modal = document.getElementById('conversation-modal');
        
        this.updateCharacterSelects();
        this.updateBranchSelects();
        
        const customImageSelect = document.getElementById('conversation-custom-image');
        customImageSelect.innerHTML = '<option value="">По умолчанию</option>' +
            this.state.portraits.map(p => `<option value="${p}">${p.split('/').pop()}</option>`).join('');
        
        const voicelineSelect = document.getElementById('conversation-voiceline');
        voicelineSelect.innerHTML = '<option value="">Без озвучки (звук персонажа)</option>' +
            this.state.voicelines.map(v => `<option value="${v}">${v.split('/').pop()}</option>`).join('');
        
        if (id) {
            const conv = this.state.conversations.find(c => c.id == id);
            if (conv) {
                document.getElementById('conversation-id').value = conv.id;
                document.getElementById('conversation-character').value = conv.character_id;
                document.getElementById('conversation-branch-select').value = conv.branch_id;
                document.getElementById('conversation-text').value = conv.text;
                document.getElementById('conversation-custom-image').value = conv.custom_image || '';
                document.getElementById('conversation-fake-name').value = conv.fake_name || '';
                document.getElementById('conversation-voiceline').value = conv.voiceline || '';
                document.getElementById('conversation-typing-speed').value = conv.typing_speed || 0;
                
                const choices = this.state.choices.filter(ch => ch.conversation_id == id);
                if (choices.length > 0) {
                    document.getElementById('has-choice').checked = true;
                    document.getElementById('choice-options-container').classList.remove('hidden');
                    document.getElementById('choice-id').value = choices[0].choice_id;
                    this.renderChoiceOptions(choices);
                } else {
                    document.getElementById('has-choice').checked = false;
                    document.getElementById('choice-options-container').classList.add('hidden');
                    document.getElementById('choice-id').value = '';
                    document.getElementById('choice-options-list').innerHTML = '';
                }
            }
        } else {
            document.getElementById('conversation-id').value = '';
            document.getElementById('conversation-character').value = '';
            document.getElementById('conversation-branch-select').value = defaultBranch;
            document.getElementById('conversation-text').value = '';
            document.getElementById('conversation-custom-image').value = '';
            document.getElementById('conversation-fake-name').value = '';
            document.getElementById('conversation-voiceline').value = '';
            document.getElementById('conversation-typing-speed').value = 0;
            document.getElementById('has-choice').checked = false;
            document.getElementById('choice-options-container').classList.add('hidden');
            document.getElementById('choice-id').value = '';
            document.getElementById('choice-options-list').innerHTML = '';
        }
        
        modal.style.display = 'flex';
    }
    
    renderChoiceOptions(choices) {
        const container = document.getElementById('choice-options-list');
        container.innerHTML = '';
        
        choices.forEach(ch => {
            const isNewBranch = !ch.target_branch;
            // Сохраняем реальный ID строки из БД в dataset.dbId
            this.addChoiceOption(ch.option_id, ch.option_text, ch.target_branch, ch.id);
            
            if (isNewBranch) {
                const lastOption = container.lastElementChild;
                const characterSelect = lastOption.querySelector('.option-character');
                if (characterSelect) {
                    characterSelect.classList.remove('hidden');
                }
            }
        });
    }
    
    addChoiceOption(id = '', text = '', target = '', dbId = null) {
        const container = document.getElementById('choice-options-list');
        const template = document.getElementById('choice-option-template');
        const optionEl = template.content.cloneNode(true);
        
        const optionDiv = optionEl.querySelector('.choice-option');
        optionDiv.dataset.optionId = id || Date.now();
        // Сохраняем реальный ID строки из БД
        if (dbId) {
            optionDiv.dataset.dbId = dbId;
        }
        
        optionEl.querySelector('.option-text').value = text;
        
        const targetSelect = optionEl.querySelector('.option-target');
        targetSelect.innerHTML = '<option value="">Новая ветка</option>' +
            this.state.branches.map(b => 
                `<option value="${b.branch_id}">${b.branch_id}</option>`
            ).join('');
        targetSelect.value = target;
        
        const characterSelect = optionEl.querySelector('.option-character');
        characterSelect.innerHTML = '<option value="">Выберите персонажа</option>' +
            this.state.characters.map(c => 
                `<option value="${c.id}">${c.name}</option>`
            ).join('');
        
        targetSelect.addEventListener('change', (e) => {
            characterSelect.classList.toggle('hidden', e.target.value !== '');
        });
        
        if (!target) {
            characterSelect.classList.remove('hidden');
        }
        
        optionEl.querySelector('.remove-option-btn').addEventListener('click', () => {
            optionDiv.remove();
        });
        
        container.appendChild(optionEl);
    }
    
async saveConversation() {
        const id = document.getElementById('conversation-id').value;
        const characterId = document.getElementById('conversation-character').value;
        const branchId = document.getElementById('conversation-branch-select').value;
        const text = document.getElementById('conversation-text').value;
        const customImage = document.getElementById('conversation-custom-image').value;
        const fakeName = document.getElementById('conversation-fake-name').value;
        const voiceline = document.getElementById('conversation-voiceline').value;
        const typingSpeed = parseFloat(document.getElementById('conversation-typing-speed').value) || 0;
        const hasChoice = document.getElementById('has-choice').checked;
        
        if (!characterId || !text) {
            alert('Выберите персонажа и введите текст');
            return;
        }
        
        try {
            const url = id 
                ? `${API_URL}/editor/conversations/${id}`
                : `${API_URL}/editor/conversations`;
            const method = id ? 'PUT' : 'POST';
            
            const sortOrder = id ? undefined : this.state.conversations.filter(c => c.branch_id === branchId).length;
            
            const body = id 
                ? { branchId, characterId, text, customImage, fakeName, voiceline, typingSpeed }
                : { dialogueId: this.state.currentDialogueId, branchId, characterId, text, customImage, fakeName, voiceline, typingSpeed, sortOrder };
            
            const response = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                alert(data.message);
                return;
            }
            
            const conversationId = id || data.conversationId;
            
            if (hasChoice) {
                await this.saveChoices(conversationId);
            }
            
            document.getElementById('conversation-modal').style.display = 'none';
            await this.selectDialogue(this.state.currentDialogueId);
            
        } catch (error) {
            console.error('Error:', error);
            alert('Ошибка сохранения реплики');
        }
    }
    
    async saveChoices(conversationId) {
        const choiceId = document.getElementById('choice-id').value || 
            `choice_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        
        const options = [];
        document.querySelectorAll('.choice-option').forEach((opt, i) => {
            const targetBranch = opt.querySelector('.option-target').value;
            const characterSelect = opt.querySelector('.option-character');
            const characterId = characterSelect ? characterSelect.value : '';
            
            options.push({
                dbId: opt.dataset.dbId || null, // Реальный ID строки из БД
                optionId: opt.dataset.optionId || `opt_${i}_${Date.now()}`,
                optionText: opt.querySelector('.option-text').value,
                targetBranch: targetBranch,
                characterId: characterId,
                isNewBranch: !targetBranch,
                sortOrder: i
            });
        });
        
        for (const opt of options) {
            if (!opt.optionText) continue;
            
            let targetBranch = opt.targetBranch;
            
            if (opt.isNewBranch) {
                if (!opt.characterId) {
                    alert(`Выберите персонажа для варианта "${opt.optionText}" или укажите существующую ветку`);
                    return;
                }
                
                const branchId = `branch_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                
                try {
                    const createResponse = await fetch(`${API_URL}/editor/branches/with-conversation`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({
                            dialogueId: this.state.currentDialogueId,
                            branchId: branchId,
                            characterId: opt.characterId,
                            conversationId: conversationId,
                            choiceId: choiceId,
                            optionId: opt.optionId,
                            optionText: opt.optionText,
                            sortOrder: opt.sortOrder
                        })
                    });
                    
                    const createData = await createResponse.json();
                    
                    if (!createResponse.ok) {
                        alert(createData.message || 'Ошибка создания ветки');
                        return;
                    }
                    
                    targetBranch = branchId;
                    continue;
                } catch (err) {
                    console.error('Error creating branch with conversation:', err);
                    alert('Ошибка создания ветки');
                    return;
                }
            }
            
            // Проверяем, есть ли реальный ID строки из БД
            if (opt.dbId) {
                // Обновляем существующий выбор по ID строки
                await fetch(`${API_URL}/editor/choices/${opt.dbId}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        conversationId,
                        choiceId,
                        optionId: opt.optionId,
                        optionText: opt.optionText,
                        targetBranch: targetBranch,
                        sortOrder: opt.sortOrder
                    })
                });
            } else {
                // Создаем новый выбор
                await fetch(`${API_URL}/editor/choices`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({
                        conversationId,
                        choiceId,
                        optionId: opt.optionId,
                        optionText: opt.optionText,
                        targetBranch: targetBranch,
                        sortOrder: opt.sortOrder
                    })
                });
            }
        }
    }
    
    async deleteConversation(id) {
        if (!confirm('Удалить реплику?')) return;
        
        try {
            await fetch(`${API_URL}/editor/conversations/${id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            await this.selectDialogue(this.state.currentDialogueId);
            
        } catch (error) {
            console.error('Error:', error);
            alert('Ошибка удаления');
        }
    }
    
    async createBranch() {
        const branchId = document.getElementById('new-branch-id').value.trim();
        
        if (!branchId) {
            alert('Укажите ID ветки');
            return;
        }
        
        try {
            const response = await fetch(`${API_URL}/editor/branches`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    dialogueId: this.state.currentDialogueId,
                    branchId
                })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                alert(data.message);
                return;
            }
            
            document.getElementById('branch-modal').style.display = 'none';
            document.getElementById('new-branch-id').value = '';
            
            await this.selectDialogue(this.state.currentDialogueId);
            
        } catch (error) {
            console.error('Error:', error);
            alert('Ошибка создания ветки');
        }
    }
    
    async deleteBranch(branchId) {
        if (!confirm('Удалить ветку и все реплики в ней?')) return;
        
        try {
            await fetch(`${API_URL}/editor/branches/${this.state.currentDialogueId}/${branchId}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            
            await this.selectDialogue(this.state.currentDialogueId);
            
        } catch (error) {
            console.error('Error:', error);
            alert('Ошибка удаления ветки');
        }
    }
    
async uploadFile(event, type) {
        const file = event.target.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append(type, file);
        
        try {
            const response = await fetch(`${API_URL}/editor/files/upload-${type}`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                alert(data.message);
                return;
            }
            
            await this.loadFiles();
            
            if (type === 'portrait') {
                const select = document.getElementById('character-portrait');
                select.innerHTML = '<option value="">Выберите файл...</option>' +
                    this.state.portraits.map(p => `<option value="${p}">${p.split('/').pop()}</option>`).join('');
                select.value = data.path;
                document.getElementById('portrait-preview').style.backgroundImage = `url('${getAssetUrl(data.path)}')`;
            } else if (type === 'sound') {
                const select = document.getElementById('character-voice');
                select.innerHTML = '<option value="">Выберите файл...</option>' +
                    this.state.sounds.map(s => `<option value="${s}">${s.split('/').pop()}</option>`).join('');
                select.value = data.path;
            } else if (type === 'voiceline') {
                const characterSelect = document.getElementById('character-voiceline');
                if (characterSelect) {
                    characterSelect.innerHTML = '<option value="">Выберите файл...</option>' +
                        this.state.voicelines.map(v => `<option value="${v}">${v.split('/').pop()}</option>`).join('');
                    characterSelect.value = data.path;
                }
                
                const conversationSelect = document.getElementById('conversation-voiceline');
                if (conversationSelect) {
                    conversationSelect.innerHTML = '<option value="">Без озвучки (звук персонажа)</option>' +
                        this.state.voicelines.map(v => `<option value="${v}">${v.split('/').pop()}</option>`).join('');
                    conversationSelect.value = data.path;
                }
            }
            
        } catch (error) {
            console.error('Error:', error);
            alert('Ошибка загрузки файла');
        }
    }
    
    async logout() {
        await fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' });
        window.location.href = 'login.html';
    }
    
    generateBackgroundCode() {
        const bgElement = document.getElementById('bgCode');
        if (!bgElement) return;
        
        const codeStrings = [
            "function initDialogueEditor() { return { status: 'ACTIVE' }; }",
            "const dialogueTree = new DialogueTreeBuilder();",
            "await db.saveConversation(dialogueData);",
            "class CharacterManager { constructor() { this.characters = []; } }",
            "for (const branch of dialogue.branches) { renderBranch(branch); }",
            "const node = tree.createNode(conversation);"
        ];
        
        for (let i = 0; i < 30; i++) {
            const line = document.createElement('div');
            line.className = 'code-line';
            line.textContent = codeStrings[Math.floor(Math.random() * codeStrings.length)];
            line.style.left = `${Math.random() * 100}%`;
            line.style.animationDuration = `${10 + Math.random() * 20}s`;
            line.style.animationDelay = `${Math.random() * 10}s`;
            bgElement.appendChild(line);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const editor = new DialogueEditor();
    editor.init();
});
