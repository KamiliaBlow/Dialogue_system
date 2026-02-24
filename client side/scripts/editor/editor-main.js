import AppConfig from '../config.js';

const { API_URL } = AppConfig;

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
            selectedNodeId: null
        };
    }
    
    async init() {
        try {
            await this.checkAuth();
            await this.loadDialogues();
            await this.loadFiles();
            this.initEventListeners();
            this.generateBackgroundCode();
        } catch (error) {
            console.error('Init error:', error);
            alert('Ошибка загрузки');
        }
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
        const [portraitsRes, soundsRes] = await Promise.all([
            fetch(`${API_URL}/editor/files/portraits`, { credentials: 'include' }),
            fetch(`${API_URL}/editor/files/sounds`, { credentials: 'include' })
        ]);
        
        const portraitsData = await portraitsRes.json();
        const soundsData = await soundsRes.json();
        
        this.state.portraits = portraitsData.files || [];
        this.state.sounds = soundsData.files || [];
    }
    
    renderDialogueList() {
        const container = document.getElementById('dialogue-list');
        
        if (this.state.dialogues.length === 0) {
            container.innerHTML = '<div class="no-data">Нет диалогов</div>';
            return;
        }
        
        container.innerHTML = this.state.dialogues.map(d => `
            <div class="dialogue-item" data-id="${d.id}">
                <div class="dialogue-item-frequency">${d.frequency}</div>
                <div class="dialogue-item-title">${d.title || 'Без названия'}</div>
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
        document.getElementById('dialogue-access').value = allowedUsers.includes(-1) ? 'all' : 'custom';
    }
    
    renderCharacters() {
        const container = document.getElementById('characters-container');
        
        if (this.state.characters.length === 0) {
            container.innerHTML = '<div class="no-data">Персонажи не добавлены</div>';
            return;
        }
        
        container.innerHTML = this.state.characters.map(c => `
            <div class="character-card" data-id="${c.id}">
                <div class="character-portrait" style="background-image: url('${c.image || 'assets/images/portraits/static.gif'}')"></div>
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
        const container = document.getElementById('dialogue-tree');
        container.innerHTML = '';
        
        const branchTemplate = document.getElementById('tree-branch-template');
        const nodeTemplate = document.getElementById('tree-node-template');
        
        this.state.branches.forEach(branch => {
            const branchEl = branchTemplate.content.cloneNode(true);
            const branchDiv = branchEl.querySelector('.tree-branch');
            branchDiv.dataset.branchId = branch.branch_id;
            branchEl.querySelector('.branch-title').textContent = 
                branch.branch_id === 'main' ? 'Главная ветка' : `Ветка: ${branch.branch_id}`;
            
            const conversations = this.state.conversations.filter(c => c.branch_id === branch.branch_id);
            const contentDiv = branchEl.querySelector('.branch-content');
            
            conversations.forEach(conv => {
                const nodeEl = nodeTemplate.content.cloneNode(true);
                const nodeDiv = nodeEl.querySelector('.tree-node');
                nodeDiv.dataset.id = conv.id;
                nodeDiv.dataset.type = 'conversation';
                
                const char = this.state.characters.find(c => c.id === conv.character_id);
                nodeEl.querySelector('.node-speaker').textContent = char ? char.name : 'Система';
                
                let text = conv.text.substring(0, 100);
                if (conv.text.length > 100) text += '...';
                nodeEl.querySelector('.node-text').textContent = text;
                
                const choices = this.state.choices.filter(ch => ch.conversation_id === conv.id);
                if (choices.length > 0) {
                    const choiceDiv = nodeEl.querySelector('.node-choice');
                    choiceDiv.classList.remove('hidden');
                    choiceDiv.innerHTML = '<strong>Выбор:</strong><br>' + 
                        choices.map(ch => `• ${ch.option_text}`).join('<br>');
                }
                
                nodeEl.querySelector('.edit-node-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.openConversationModal(conv.id);
                });
                
                nodeEl.querySelector('.delete-node-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteConversation(conv.id);
                });
                
                contentDiv.appendChild(nodeEl);
            });
            
            branchEl.querySelector('.delete-branch-btn').addEventListener('click', () => {
                if (branch.branch_id !== 'main') {
                    this.deleteBranch(branch.branch_id);
                }
            });
            
            container.appendChild(branchEl);
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
        const selects = ['conversation-branch-select', 'option-target'];
        this.state.branches.forEach(branch => {
            selects.forEach(id => {
                const select = document.getElementById(id);
                if (select) {
                    const option = document.createElement('option');
                    option.value = branch.branch_id;
                    option.textContent = branch.branch_id === 'main' ? 'Главная ветка' : branch.branch_id;
                    select.appendChild(option);
                }
            });
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
            preview.style.backgroundImage = e.target.value ? `url('${e.target.value}')` : 'none';
        });
        
        document.getElementById('upload-portrait-btn').addEventListener('click', () => {
            document.getElementById('upload-portrait').click();
        });
        
        document.getElementById('upload-portrait').addEventListener('change', (e) => this.uploadFile(e, 'portrait'));
        
        document.getElementById('upload-voice-btn').addEventListener('click', () => {
            document.getElementById('upload-voice').click();
        });
        
        document.getElementById('upload-voice').addEventListener('change', (e) => this.uploadFile(e, 'sound'));
        
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
        
        const allowedUsers = access === 'all' ? [-1] : [];
        
        try {
            const response = await fetch(`${API_URL}/editor/dialogues/${this.state.currentDialogueId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ frequency, title, allowedUsers })
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
        
        portraitSelect.innerHTML = '<option value="">Выберите файл...</option>' +
            this.state.portraits.map(p => `<option value="${p}">${p.split('/').pop()}</option>`).join('');
        
        voiceSelect.innerHTML = '<option value="">Без звука</option>' +
            this.state.sounds.map(s => `<option value="${s}">${s.split('/').pop()}</option>`).join('');
        
        if (id) {
            const char = this.state.characters.find(c => c.id == id);
            if (char) {
                document.getElementById('character-id').value = char.id;
                document.getElementById('character-name').value = char.name;
                document.getElementById('character-window').value = char.window;
                document.getElementById('character-portrait').value = char.image || '';
                document.getElementById('character-voice').value = char.voice || '';
                document.getElementById('portrait-preview').style.backgroundImage = 
                    char.image ? `url('${char.image}')` : 'none';
            }
        } else {
            document.getElementById('character-id').value = '';
            document.getElementById('character-name').value = '';
            document.getElementById('character-window').value = '1';
            document.getElementById('character-portrait').value = '';
            document.getElementById('character-voice').value = '';
            document.getElementById('portrait-preview').style.backgroundImage = 'none';
        }
        
        modal.style.display = 'flex';
    }
    
    async saveCharacter() {
        const id = document.getElementById('character-id').value;
        const name = document.getElementById('character-name').value.trim();
        const window = document.getElementById('character-window').value;
        const image = document.getElementById('character-portrait').value;
        const voice = document.getElementById('character-voice').value;
        
        if (!name) {
            alert('Укажите имя персонажа');
            return;
        }
        
        try {
            const url = id 
                ? `${API_URL}/editor/characters/${id}`
                : `${API_URL}/editor/characters`;
            const method = id ? 'PUT' : 'POST';
            
            const body = id 
                ? { name, image, voice, window: parseInt(window) }
                : { dialogueId: this.state.currentDialogueId, name, image, voice, window: parseInt(window) };
            
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
    
    openConversationModal(id = null) {
        const modal = document.getElementById('conversation-modal');
        
        this.updateCharacterSelects();
        this.updateBranchSelects();
        
        const customImageSelect = document.getElementById('conversation-custom-image');
        customImageSelect.innerHTML = '<option value="">По умолчанию</option>' +
            this.state.portraits.map(p => `<option value="${p}">${p.split('/').pop()}</option>`).join('');
        
        if (id) {
            const conv = this.state.conversations.find(c => c.id == id);
            if (conv) {
                document.getElementById('conversation-id').value = conv.id;
                document.getElementById('conversation-character').value = conv.character_id;
                document.getElementById('conversation-branch-select').value = conv.branch_id;
                document.getElementById('conversation-text').value = conv.text;
                document.getElementById('conversation-custom-image').value = conv.custom_image || '';
                document.getElementById('conversation-fake-name').value = conv.fake_name || '';
                
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
            document.getElementById('conversation-branch-select').value = 'main';
            document.getElementById('conversation-text').value = '';
            document.getElementById('conversation-custom-image').value = '';
            document.getElementById('conversation-fake-name').value = '';
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
            this.addChoiceOption(ch.option_id, ch.option_text, ch.target_branch);
        });
    }
    
    addChoiceOption(id = '', text = '', target = '') {
        const container = document.getElementById('choice-options-list');
        const template = document.getElementById('choice-option-template');
        const optionEl = template.content.cloneNode(true);
        
        const optionDiv = optionEl.querySelector('.choice-option');
        optionDiv.dataset.optionId = id || Date.now();
        
        optionEl.querySelector('.option-text').value = text;
        
        const targetSelect = optionEl.querySelector('.option-target');
        targetSelect.innerHTML = '<option value="">Новая ветка</option>' +
            this.state.branches.map(b => 
                `<option value="${b.branch_id}">${b.branch_id}</option>`
            ).join('');
        targetSelect.value = target;
        
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
                ? { branchId, characterId, text, customImage, fakeName }
                : { dialogueId: this.state.currentDialogueId, branchId, characterId, text, customImage, fakeName, sortOrder };
            
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
            options.push({
                optionId: opt.dataset.optionId || `opt_${i}_${Date.now()}`,
                optionText: opt.querySelector('.option-text').value,
                targetBranch: opt.querySelector('.option-target').value,
                sortOrder: i
            });
        });
        
        for (const opt of options) {
            if (!opt.optionText) continue;
            
            await fetch(`${API_URL}/editor/choices`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                    conversationId,
                    choiceId,
                    ...opt
                })
            });
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
                document.getElementById('portrait-preview').style.backgroundImage = `url('${data.path}')`;
            } else {
                const select = document.getElementById('character-voice');
                select.innerHTML = '<option value="">Без звука</option>' +
                    this.state.sounds.map(s => `<option value="${s}">${s.split('/').pop()}</option>`).join('');
                select.value = data.path;
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
