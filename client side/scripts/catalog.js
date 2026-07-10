import AppConfig from './config.js';
import { escapeAttr, safeNumber } from './escape-utils.js';

const { API_URL, ASSETS_URL, CACHE_HEADERS } = AppConfig;

class CharacterCatalog {
    constructor() {
        this.characters = [];
        this.portraitFiles = [];
        this.editingId = null;
        this.portraitScale = 1.0;
        this.portraitX = 0;
        this.portraitY = 0;
        this.portraitMirror = false;
        this.dragStart = null;
        
        this.init();
    }
    
    async init() {
        try {
            const authRes = await fetch(`${API_URL}/admin/check`, {
                credentials: 'include',
                headers: CACHE_HEADERS
            });
            if (!authRes.ok) {
                window.location.href = 'index.html';
                return;
            }
            const authData = await authRes.json();
            if (!authData.isAdmin) {
                window.location.href = 'index.html';
                return;
            }
        } catch (e) {
            window.location.href = 'index.html';
            return;
        }
        
        this.generateBackground();
        this.bindEvents();
        this.loadCharacters();
        this.loadPortraitFiles();
    }
    
    generateBackground() {
        const bgElement = document.getElementById('bgCode');
        if (!bgElement) return;
        
        const codeStrings = [
            "function initGMS4521() { return { status: 'ACTIVE', secLevel: 'ALPHA-7' }; }",
            "const terminalAccess = new SecurityProtocol('ADMIN', 0x7F);",
            "if (securityBreached) { initCountermeasures(PROTOCOL.OMEGA); }",
            "class DataStream extends BinaryProtocol { constructor() { super(0x8F); } }",
            "await terminal.connect('/dev/tty0', { encrypted: true });",
            "for (let i = 0; i < dataNodes.length; i++) { validate(dataNodes[i]); }",
            "const encryptionLevel = LEVEL.MAXIMUM;",
            "function parseIncomingSignals(data) { return new Transmission(data); }",
            "encryption.applyKey(generateRandomBytes(32));",
            "while (terminal.active) { terminal.processCommands(); }",
            "const vulnerabilities = system.scanForThreats();",
            "if (userAccess.level < 7) { throw new SecurityException(); }",
            "terminal.display('АКТИВИРОВАН ПРОТОКОЛ БЕЗОПАСНОСТИ GMS-4521');",
            "for (const node of network.activeNodes) { ping(node.address); }",
            "const userAccessLevel = authentication.validateCredentials(user);"
        ];
        
        for (let i = 0; i < 50; i++) {
            const line = document.createElement('div');
            line.className = 'code-line';
            line.textContent = codeStrings[Math.floor(Math.random() * codeStrings.length)];
            line.style.left = `${Math.random() * 100}%`;
            line.style.animationDuration = `${10 + Math.random() * 20}s`;
            line.style.animationDelay = `${Math.random() * 10}s`;
            bgElement.appendChild(line);
        }
    }
    
    bindEvents() {
        document.getElementById('add-character-btn').addEventListener('click', () => this.openModal());
        document.getElementById('cancel-character').addEventListener('click', () => this.closeModal());
        document.getElementById('save-character-btn').addEventListener('click', () => this.saveCharacter());
        document.getElementById('init-relations-btn').addEventListener('click', () => this.initRelations());
        
        document.getElementById('upload-portrait-btn').addEventListener('click', () => {
            document.getElementById('upload-portrait').click();
        });
        document.getElementById('upload-portrait').addEventListener('change', (e) => this.uploadPortrait(e));
        
        document.getElementById('character-portrait-select').addEventListener('change', (e) => {
            this.previewPortrait(e.target.value);
        });
        
        document.getElementById('portrait-scale').addEventListener('input', (e) => {
            this.portraitScale = parseInt(e.target.value) / 100;
            document.getElementById('portrait-scale-value').textContent = e.target.value + '%';
            this.updatePortraitPreview();
        });
        
        document.getElementById('portrait-mirror-btn').addEventListener('click', () => {
            this.portraitMirror = !this.portraitMirror;
            this.updatePortraitPreview();
        });
        
        document.getElementById('portrait-center-btn').addEventListener('click', () => {
            this.portraitX = 0;
            this.portraitY = 0;
            this.updatePortraitPreview();
        });
        
        document.getElementById('portrait-reset-btn').addEventListener('click', () => {
            this.portraitScale = 1.0;
            this.portraitX = 0;
            this.portraitY = 0;
            this.portraitMirror = false;
            document.getElementById('portrait-scale').value = 100;
            document.getElementById('portrait-scale-value').textContent = '100%';
            this.updatePortraitPreview();
        });
        
        const previewContainer = document.getElementById('portrait-preview-container');
        previewContainer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            this.dragStart = { x: e.clientX - this.portraitX, y: e.clientY - this.portraitY };
        });
        document.addEventListener('mousemove', (e) => {
            if (!this.dragStart) return;
            this.portraitX = e.clientX - this.dragStart.x;
            this.portraitY = e.clientY - this.dragStart.y;
            this.updatePortraitPreview();
        });
        document.addEventListener('mouseup', () => { this.dragStart = null; });
        
        document.getElementById('logout-btn').addEventListener('click', () => {
            fetch(`${API_URL}/auth/logout`, { method: 'POST', credentials: 'include' }).then(() => {
                window.location.href = 'index.html';
            });
        });
        
        document.getElementById('character-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) e.target.style.display = 'none';
        });
        
        document.getElementById('relations-modal').addEventListener('click', (e) => {
            if (e.target === e.currentTarget) e.target.style.display = 'none';
        });
        document.getElementById('close-relations-modal').addEventListener('click', () => {
            document.getElementById('relations-modal').style.display = 'none';
        });
    }
    
    async loadCharacters() {
        try {
            const res = await fetch(`${API_URL}/editor/global-characters`, {
                credentials: 'include',
                headers: CACHE_HEADERS
            });
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            this.characters = data.characters || [];
            this.renderGrid();
        } catch (err) {
            console.error('Error loading characters:', err);
            document.getElementById('catalog-grid').innerHTML = '<div class="catalog-empty">Ошибка загрузки персонажей</div>';
        }
    }
    
    async loadPortraitFiles() {
        try {
            const res = await fetch(`${API_URL}/editor/files/portraits`, {
                credentials: 'include',
                headers: CACHE_HEADERS
            });
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            this.portraitFiles = (data.files || []).map(f => f.split('/').pop());
        } catch (err) {
            console.error('Error loading portrait files:', err);
        }
    }
    
    renderGrid() {
        const grid = document.getElementById('catalog-grid');
        if (this.characters.length === 0) {
            grid.innerHTML = '<div class="catalog-empty">Нет персонажей. Нажмите "+ Новый персонаж" для создания.</div>';
            return;
        }
        
        grid.innerHTML = this.characters.map(c => {
            const imgSrc = c.image ? `${ASSETS_URL}/${c.image.replace('/assets/', '')}` : '';
            const relColor = c.default_relation > 0 ? '#03fb8d' : c.default_relation < 0 ? '#ff3333' : 'rgba(3,251,141,0.7)';
            const scale = safeNumber(c.portrait_scale, 1);
            const posX = safeNumber(c.portrait_x, 0);
            const posY = safeNumber(c.portrait_y, 0);
            return `
                <div class="catalog-card" data-id="${escapeAttr(c.id)}">
                    <div class="catalog-card-portrait">
                        ${imgSrc ? `<img src="${escapeAttr(imgSrc)}" alt="${this.escapeHtml(c.name)}" style="transform: scale(${scale}) translateX(${posX}px) translateY(${posY}px) scaleX(${c.portrait_mirror ? -1 : 1});">` : ''}
                    </div>
                    <div class="catalog-card-name">${this.escapeHtml(c.name)}</div>
                    <div class="catalog-card-relation" style="color:${relColor}">Базовое отношение: ${this.escapeHtml(c.default_relation || 0)}</div>
                    <div class="catalog-card-actions">
                        <button class="btn btn-small relations-btn" data-id="${escapeAttr(c.id)}" data-name="${this.escapeHtml(c.name)}">Отношения</button>
                        <button class="btn btn-small edit-btn" data-id="${escapeAttr(c.id)}">Изменить</button>
                        <button class="btn btn-small btn-danger delete-btn" data-id="${escapeAttr(c.id)}">Удалить</button>
                    </div>
                </div>
            `;
        }).join('');
        
        grid.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', () => this.openModal(parseInt(btn.dataset.id)));
        });
        grid.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', () => this.deleteCharacter(parseInt(btn.dataset.id)));
        });
        grid.querySelectorAll('.relations-btn').forEach(btn => {
            btn.addEventListener('click', () => this.openRelationsModal(parseInt(btn.dataset.id), btn.dataset.name));
        });
    }
    
    openModal(editId = null) {
        this.editingId = editId;
        const modal = document.getElementById('character-modal');
        const title = document.getElementById('modal-title');
        
        document.getElementById('character-id').value = '';
        document.getElementById('character-name').value = '';
        document.getElementById('character-default-relation').value = '0';
        document.getElementById('character-portrait-select').innerHTML = '<option value="">Выберите файл...</option>';
        document.getElementById('portrait-preview-img').style.display = 'none';
        this.portraitScale = 1.0;
        this.portraitX = 0;
        this.portraitY = 0;
        this.portraitMirror = false;
        document.getElementById('portrait-scale').value = 100;
        document.getElementById('portrait-scale-value').textContent = '100%';
        
        const portraitSelect = document.getElementById('character-portrait-select');
        this.portraitFiles.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            portraitSelect.appendChild(opt);
        });
        
        if (editId) {
            title.textContent = 'Редактирование персонажа';
            const char = this.characters.find(c => c.id === editId);
            if (char) {
                document.getElementById('character-id').value = char.id;
                document.getElementById('character-name').value = char.name;
                document.getElementById('character-default-relation').value = char.default_relation || 0;
                this.portraitScale = char.portrait_scale || 1.0;
                this.portraitX = char.portrait_x || 0;
                this.portraitY = char.portrait_y || 0;
                this.portraitMirror = char.portrait_mirror === 1;
                document.getElementById('portrait-scale').value = Math.round(this.portraitScale * 100);
                document.getElementById('portrait-scale-value').textContent = Math.round(this.portraitScale * 100) + '%';
                
                if (char.image) {
                    const filename = char.image.split('/').pop();
                    for (const opt of portraitSelect.options) {
                        if (opt.value === filename) { opt.selected = true; break; }
                    }
                    this.previewPortrait(filename);
                }
            }
        } else {
            title.textContent = 'Новый персонаж';
        }
        
        modal.style.display = 'flex';
    }
    
    closeModal() {
        document.getElementById('character-modal').style.display = 'none';
        this.editingId = null;
    }
    
    previewPortrait(filename) {
        const img = document.getElementById('portrait-preview-img');
        if (!filename) {
            img.style.display = 'none';
            return;
        }
        img.src = `${ASSETS_URL}/images/portraits/${filename}`;
        img.style.display = 'block';
        this.updatePortraitPreview();
    }
    
    updatePortraitPreview() {
        const img = document.getElementById('portrait-preview-img');
        if (!img || img.style.display === 'none') return;
        img.style.transform = `translate(-50%, -50%) scale(${this.portraitScale}) translateX(${this.portraitX}px) translateY(${this.portraitY}px) scaleX(${this.portraitMirror ? -1 : 1})`;
    }
    
    async uploadPortrait(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const formData = new FormData();
        formData.append('portrait', file);
        
        try {
            const res = await fetch(`${API_URL}/editor/upload-portrait`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });
            const data = await res.json();
            if (res.ok) {
                await this.loadPortraitFiles();
                const select = document.getElementById('character-portrait-select');
                select.innerHTML = '<option value="">Выберите файл...</option>';
                this.portraitFiles.forEach(f => {
                    const opt = document.createElement('option');
                    opt.value = f;
                    opt.textContent = f;
                    if (f === data.filename) opt.selected = true;
                    select.appendChild(opt);
                });
                this.previewPortrait(data.filename);
            }
        } catch (err) {
            console.error('Upload error:', err);
        }
    }
    
    async saveCharacter() {
        const name = document.getElementById('character-name').value.trim();
        if (!name) { alert('Введите имя персонажа'); return; }
        
        const defaultRelation = parseInt(document.getElementById('character-default-relation').value) || 0;
        const portraitSelect = document.getElementById('character-portrait-select').value;
        
        const formData = new FormData();
        formData.append('name', name);
        formData.append('defaultRelation', defaultRelation);
        formData.append('portraitScale', this.portraitScale);
        formData.append('portraitX', this.portraitX);
        formData.append('portraitY', this.portraitY);
        formData.append('portraitMirror', this.portraitMirror ? '1' : '0');
        if (portraitSelect) {
            formData.append('keepImage', portraitSelect);
        } else if (this.editingId) {
            formData.append('keepImage', '');
        }
        
        try {
            let res;
            if (this.editingId) {
                res = await fetch(`${API_URL}/editor/global-characters/${this.editingId}`, {
                    method: 'PUT',
                    credentials: 'include',
                    body: formData
                });
            } else {
                res = await fetch(`${API_URL}/editor/global-characters`, {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                });
            }
            
            const data = await res.json();
            if (res.ok) {
                this.closeModal();
                this.loadCharacters();
            } else {
                alert(data.message || 'Ошибка сохранения');
            }
        } catch (err) {
            console.error('Save error:', err);
            alert('Ошибка сохранения');
        }
    }
    
    async deleteCharacter(id) {
        const char = this.characters.find(c => c.id === id);
        if (!char) return;
        if (!confirm(`Удалить персонажа "${char.name}"?`)) return;
        
        try {
            const res = await fetch(`${API_URL}/editor/global-characters/${id}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: CACHE_HEADERS
            });
            const data = await res.json();
            if (res.ok) {
                this.loadCharacters();
            } else {
                alert(data.message || 'Ошибка удаления');
            }
        } catch (err) {
            console.error('Delete error:', err);
            alert('Ошибка удаления');
        }
    }
    
    async initRelations() {
        if (!confirm('Инициализировать отношения для всех пользователей и персонажей?')) return;
        try {
            const res = await fetch(`${API_URL}/editor/global-characters/init-relations`, {
                method: 'POST',
                credentials: 'include',
                headers: CACHE_HEADERS
            });
            const data = await res.json();
            alert(data.message);
        } catch (err) {
            console.error('Init relations error:', err);
            alert('Ошибка инициализации');
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    async openRelationsModal(characterId, characterName) {
        const modal = document.getElementById('relations-modal');
        const tbody = document.getElementById('relations-tbody');
        
        document.getElementById('relations-modal-title').textContent = `Отношения: ${characterName}`;
        document.getElementById('relations-loading').style.display = 'block';
        document.getElementById('relations-content').style.display = 'none';
        modal.style.display = 'flex';
        
        try {
            const res = await fetch(`${API_URL}/editor/global-characters/${characterId}/relations`, {
                credentials: 'include',
                headers: CACHE_HEADERS
            });
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            
            const relationsMap = {};
            data.relations.forEach(r => { relationsMap[r.user_id] = r; });
            
            const defaultRel = data.character.default_relation || 0;
            
            tbody.innerHTML = data.users.map(user => {
                const rel = relationsMap[user.id];
                const value = rel ? rel.relation_value : defaultRel;
                const relId = rel ? rel.id : null;
                const color = value > 0 ? '#03fb8d' : value < 0 ? '#ff3333' : 'inherit';
                return `
                    <tr data-rel-id="${escapeAttr(relId)}" data-user-id="${escapeAttr(user.id)}" data-gc-id="${escapeAttr(characterId)}">
                        <td>${this.escapeHtml(user.username)}</td>
                        <td>
                            <input type="number" class="form-input relation-value-input"
                                   value="${escapeAttr(value)}" min="-100" max="100" step="5"
                                   style="width:100%;color:${color};text-align:center;">
                        </td>
                        <td>
                            <button class="btn btn-small save-relation-btn">✓</button>
                        </td>
                    </tr>
                `;
            }).join('');
            
            document.getElementById('relations-loading').style.display = 'none';
            document.getElementById('relations-content').style.display = 'block';
            
            tbody.querySelectorAll('.save-relation-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const row = e.target.closest('tr');
                    this.saveRelationValue(row);
                });
            });
            
            tbody.querySelectorAll('.relation-value-input').forEach(input => {
                input.addEventListener('input', () => {
                    const v = parseInt(input.value) || 0;
                    input.style.color = v > 0 ? '#03fb8d' : v < 0 ? '#ff3333' : 'inherit';
                });
            });
        } catch (err) {
            console.error('Error loading relations:', err);
            document.getElementById('relations-loading').style.display = 'none';
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#ff3333;">Ошибка загрузки</td></tr>';
            document.getElementById('relations-content').style.display = 'block';
        }
    }
    
    async saveRelationValue(row) {
        const relId = row.dataset.relId;
        const userId = row.dataset.userId;
        const gcId = row.dataset.gcId;
        const input = row.querySelector('.relation-value-input');
        const value = Math.max(-100, Math.min(100, parseInt(input.value) || 0));
        input.value = value;
        
        try {
            if (relId && relId !== 'null') {
                const res = await fetch(`${API_URL}/editor/global-characters/relation/${relId}`, {
                    method: 'PUT',
                    credentials: 'include',
                    headers: { 'Content-Type': 'application/json', ...CACHE_HEADERS },
                    body: JSON.stringify({ relationValue: value })
                });
                if (!res.ok) throw new Error(res.status);
            } else {
                const res = await fetch(`${API_URL}/editor/global-characters/init-relations`, {
                    method: 'POST',
                    credentials: 'include',
                    headers: CACHE_HEADERS
                });
                if (!res.ok) throw new Error(res.status);
                this.openRelationsModal(parseInt(gcId), document.getElementById('relations-modal-title').textContent.replace('Отношения: ', ''));
                return;
            }
            
            const btn = row.querySelector('.save-relation-btn');
            const origText = btn.textContent;
            btn.textContent = '✓';
            btn.style.color = '#03fb8d';
            setTimeout(() => { btn.textContent = origText; btn.style.color = ''; }, 1000);
        } catch (err) {
            console.error('Error saving relation:', err);
            alert('Ошибка сохранения');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new CharacterCatalog();
});
