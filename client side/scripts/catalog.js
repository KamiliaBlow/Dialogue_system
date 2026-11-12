import AppConfig from './config.js';
import { escapeAttr, safeNumber } from './escape-utils.js';
import { applyAdminTheme } from './admin-theme.js';

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
        
        applyAdminTheme();
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

            this._relData = data;
            this._relCharId = characterId;

            // Стартовые значения (пилот 0) и значения по пилотам — раздельно
            const baseMap = {};
            const pilotMap = {};
            data.relations.forEach(r => {
                if (r.pilot_profile_id === 0) baseMap[r.user_id] = r;
                else pilotMap[`${r.user_id}_${r.pilot_profile_id}`] = r;
            });
            this._relPilotMap = pilotMap;

            const defaultRel = data.character.default_relation || 0;

            tbody.innerHTML = data.users.map(user => {
                const base = baseMap[user.id];
                const value = base ? base.relation_value : defaultRel;
                const relId = base ? base.id : null;
                const color = value > 0 ? '#03fb8d' : value < 0 ? '#ff3333' : 'inherit';
                return `
                    <tr class="rel-user-row" data-rel-id="${escapeAttr(relId)}" data-user-id="${escapeAttr(user.id)}" data-gc-id="${escapeAttr(characterId)}" style="cursor:pointer;">
                        <td>
                            <span class="rel-toggle" style="display:inline-block;width:14px;color:var(--primary-color);">▸</span>
                            ${this.escapeHtml(user.username)}
                        </td>
                        <td>
                            <input type="number" class="form-input relation-value-input"
                                   value="${escapeAttr(value)}" min="-100" max="100" step="5"
                                   style="width:100%;color:${color};text-align:center;">
                            <div style="font-size:10px;color:#888;margin-top:3px;">Применяется ко всем пилотам аккаунта</div>
                        </td>
                        <td>
                            <button class="btn btn-small save-relation-btn">✓</button>
                        </td>
                    </tr>
                    <tr class="rel-pilots-row" data-user-id="${escapeAttr(user.id)}" style="display:none;">
                        <td colspan="3" class="rel-pilots-cell" style="padding:4px 10px;background:rgba(128,128,128,0.06);"></td>
                    </tr>
                `;
            }).join('');

            document.getElementById('relations-loading').style.display = 'none';
            document.getElementById('relations-content').style.display = 'block';

            tbody.querySelectorAll('.save-relation-btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const row = btn.closest('tr');
                    this.saveRelationValue(row);
                });
            });

            tbody.querySelectorAll('.relation-value-input').forEach(input => {
                input.addEventListener('input', () => {
                    const v = parseInt(input.value) || 0;
                    input.style.color = v > 0 ? '#03fb8d' : v < 0 ? '#ff3333' : 'inherit';
                    this.markDirty(input);
                });
            });

            // Клик по строке пользователя раскрывает список его пилотов
            tbody.querySelectorAll('.rel-user-row').forEach(row => {
                row.addEventListener('click', (e) => {
                    if (e.target.closest('input, button, label')) return;
                    this.toggleUserPilots(row);
                });
                row.querySelector('.rel-toggle')?.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleUserPilots(row);
                });
            });
        } catch (err) {
            console.error('Error loading relations:', err);
            document.getElementById('relations-loading').style.display = 'none';
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;color:#ff3333;">Ошибка загрузки</td></tr>';
            document.getElementById('relations-content').style.display = 'block';
        }
    }

    // Раскрыть/свернуть список пилотов пользователя в модалке отношений.
    async toggleUserPilots(userRow) {
        const userId = userRow.dataset.userId;
        const gcId = userRow.dataset.gcId;
        const pilotsRow = userRow.nextElementSibling;
        if (!pilotsRow || !pilotsRow.classList.contains('rel-pilots-row')) return;
        const cell = pilotsRow.querySelector('.rel-pilots-cell');
        const toggle = userRow.querySelector('.rel-toggle');

        if (pilotsRow.style.display !== 'none') {
            pilotsRow.style.display = 'none';
            if (toggle) toggle.textContent = '▸';
            return;
        }

        if (cell.dataset.loaded === '1') {
            pilotsRow.style.display = 'table-row';
            if (toggle) toggle.textContent = '▾';
            return;
        }

        cell.innerHTML = '<span style="font-size:11px;color:#888;">Загрузка пилотов...</span>';
        pilotsRow.style.display = 'table-row';
        if (toggle) toggle.textContent = '▾';

        try {
            const res = await fetch(`${API_URL}/editor/users/${userId}/pilots`, {
                credentials: 'include',
                headers: CACHE_HEADERS
            });
            if (!res.ok) throw new Error(res.status);
            const data = await res.json();
            const pilots = data.pilots || [];

            if (pilots.length === 0) {
                cell.innerHTML = '<span style="font-size:11px;color:#888;">У пользователя нет пилотов.</span>';
                cell.dataset.loaded = '1';
                return;
            }

            const baseValue = parseInt(userRow.querySelector('.relation-value-input')?.value) || 0;
            const rows = pilots.map(p => {
                const rel = this._relPilotMap[`${userId}_${p.id}`];
                const value = rel ? rel.relation_value : baseValue;
                const color = value > 0 ? '#03fb8d' : value < 0 ? '#ff3333' : 'inherit';
                const activeMark = p.is_active ? ' <span style="color:var(--primary-color);font-size:10px;">● активен</span>' : '';
                return `
                    <div class="rel-pilot-item" data-user-id="${escapeAttr(userId)}" data-gc-id="${escapeAttr(gcId)}"
                         data-pilot-id="${escapeAttr(p.id)}" style="display:flex;align-items:center;gap:8px;padding:4px 0 4px 16px;border-bottom:1px dashed var(--primary-border);">
                        <span style="min-width:150px;font-size:12px;">${this.escapeHtml(p.callsign || ('Пилот ' + p.slot_number))}${activeMark}</span>
                        <input type="number" class="form-input rel-pilot-value-input" value="${escapeAttr(value)}"
                               min="-100" max="100" step="5" style="width:70px;font-size:12px;padding:3px 6px;color:${color};text-align:center;">
                        <button class="btn btn-small rel-pilot-save-btn" style="font-size:11px;padding:3px 8px;">✓</button>
                    </div>
                `;
            }).join('');
            cell.innerHTML = rows;

            cell.querySelectorAll('.rel-pilot-value-input').forEach(input => {
                input.addEventListener('input', () => {
                    const v = parseInt(input.value) || 0;
                    input.style.color = v > 0 ? '#03fb8d' : v < 0 ? '#ff3333' : 'inherit';
                    this.markDirty(input);
                });
            });
            cell.querySelectorAll('.rel-pilot-save-btn').forEach(btn => {
                btn.addEventListener('click', () => this.savePilotRelationValue(btn.closest('.rel-pilot-item')));
            });
            cell.dataset.loaded = '1';
        } catch (err) {
            console.error('Error loading pilots:', err);
            cell.innerHTML = '<span style="font-size:11px;color:#ff3333;">Ошибка загрузки пилотов</span>';
        }
    }

    // Сохранить отношение конкретного пилота.
    async savePilotRelationValue(item) {
        const userId = item.dataset.userId;
        const gcId = item.dataset.gcId;
        const pilotId = item.dataset.pilotId;
        const input = item.querySelector('.rel-pilot-value-input');
        const value = Math.max(-100, Math.min(100, parseInt(input.value) || 0));
        input.value = value;

        try {
            const res = await fetch(`${API_URL}/editor/global-characters/${gcId}/user/${userId}/relation`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...CACHE_HEADERS },
                body: JSON.stringify({ relationValue: value, pilotProfileId: pilotId })
            });
            if (!res.ok) throw new Error(res.status);

            this.markClean(input);

            const btn = item.querySelector('.rel-pilot-save-btn');
            const origText = btn.textContent;
            btn.textContent = '✓';
            btn.style.color = '#03fb8d';
            setTimeout(() => { btn.textContent = origText; btn.style.color = ''; }, 1000);
        } catch (err) {
            console.error('Error saving pilot relation:', err);
            alert('Ошибка сохранения');
        }
    }

    // Подсветка несохранённых изменений (жёлтый) и снятие её после сохранения.
    markDirty(input) {
        input.style.borderColor = '#ffcc00';
        input.style.boxShadow = '0 0 5px rgba(255, 204, 0, 0.6)';
    }

    markClean(input) {
        input.style.borderColor = '';
        input.style.boxShadow = '';
    }

    async saveRelationValue(row) {
        const userId = row.dataset.userId;
        const gcId = row.dataset.gcId;
        const input = row.querySelector('.relation-value-input');
        const value = Math.max(-100, Math.min(100, parseInt(input.value) || 0));
        input.value = value;

        try {
            // Базовое отношение пользователя: по умолчанию перезаписывается
            // у всех пилотов аккаунта (глобальное применение).
            const res = await fetch(`${API_URL}/editor/global-characters/${gcId}/user/${userId}/relation`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...CACHE_HEADERS },
                body: JSON.stringify({ relationValue: value, global: true })
            });
            if (!res.ok) throw new Error(res.status);

            this.markClean(input);

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
