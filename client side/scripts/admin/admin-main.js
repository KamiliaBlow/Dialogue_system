import AppConfig from '../config.js';
import AdminAPI from './admin-api.js';
import ChartManager from './admin-charts.js';
import AdminUtils from './admin-utils.js';
import { escapeHtml, escapeAttr } from '../escape-utils.js';
import { applyAdminTheme } from '../admin-theme.js';

const { ITEMS_PER_PAGE } = AppConfig;

class AdminApp {
    constructor() {
        this.state = {
            users: [],
            currentUserPage: 1,
            totalUserPages: 1,
            choiceStats: [],
            currentFrequency: 'all',
            progressData: [],
            frequencies: []
        };
        
        this.chartManager = new ChartManager();
        this.api = AdminAPI;
        this.utils = AdminUtils;
    }
    
    async init() {
        try {
            const authData = await this.api.checkAuth();
            
            if (!authData.isAdmin) {
                this.showError('У вас нет прав администратора');
                setTimeout(() => window.location.href = 'index.html', 2000);
                return;
            }
            
            this.initTabs();
            applyAdminTheme();
            await this.updateFrequencyTabs();
            this.loadStatisticsData();
            this.initEventListeners();
            this.utils.generateBackgroundCode();
            
        } catch (error) {
            console.error('Init error:', error);
            this.showError('Ошибка подключения к серверу. Проверьте, что сервер запущен на порту 3000');
        }
    }
    
    showError(message) {
        const container = document.querySelector('.container');
        if (container) {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'admin-card';
            errorDiv.innerHTML = `
                <div class="admin-card-title" style="color: #ff3333;">Ошибка</div>
                <p>${message}</p>
                <button class="btn" onclick="location.reload()">Повторить</button>
                <button class="btn" onclick="window.location.href='index.html'">На главную</button>
            `;
            container.innerHTML = '';
            container.appendChild(errorDiv);
        }
    }
    
    initEventListeners() {
        document.getElementById('logout-btn')?.addEventListener('click', () => this.logout());
        this.initModals();
        this.initMusicTab();
    }
    
    initTabs() {
        const tabs = document.querySelectorAll('.admin-tab');
        const contents = document.querySelectorAll('.tab-content');
        
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                const tabName = tab.dataset.tab;
                
                tabs.forEach(t => t.classList.remove('active'));
                contents.forEach(c => c.classList.remove('active'));
                
                tab.classList.add('active');
                document.getElementById(tabName)?.classList.add('active');
                
                this.loadTabData(tabName);
            });
        });
    }
    
    async loadTabData(tabName) {
        const loaders = {
            statistics: () => this.loadStatisticsData(),
            users: () => this.loadUsersData(),
            choices: async () => {
                await this.updateFrequencyTabs();
                this.loadChoicesData();
            },
            progress: () => this.loadProgressData(),
            relations: () => this.loadRelationsData(),
            music: () => this.loadMusicData()
        };
        
        await loaders[tabName]?.();
    }
    
    initModals() {
        const passwordModal = document.getElementById('password-modal');
        const detailsModal = document.getElementById('choice-details-modal');
        const deleteModal = document.getElementById('delete-user-modal');
        const clearModal = document.getElementById('clear-progress-modal');
        
        document.getElementById('cancel-password')?.addEventListener('click', () => {
            passwordModal.style.display = 'none';
        });
        
        document.getElementById('save-password')?.addEventListener('click', () => this.changePassword());
        document.getElementById('close-details')?.addEventListener('click', () => {
            detailsModal.style.display = 'none';
        });
        
        document.getElementById('cancel-delete')?.addEventListener('click', () => {
            deleteModal.style.display = 'none';
        });
        
        document.getElementById('confirm-delete')?.addEventListener('click', () => this.deleteUser());
        
        document.getElementById('cancel-clear')?.addEventListener('click', () => {
            clearModal.style.display = 'none';
        });
        
        document.getElementById('confirm-clear')?.addEventListener('click', () => this.clearProgress());
        
        window.addEventListener('click', (e) => {
            if (e.target === passwordModal) passwordModal.style.display = 'none';
            if (e.target === detailsModal) detailsModal.style.display = 'none';
            if (e.target === deleteModal) deleteModal.style.display = 'none';
            if (e.target === clearModal) clearModal.style.display = 'none';
        });
    }
    
    async updateFrequencyTabs() {
        const container = document.querySelector('.sub-tabs');
        if (!container) return;
        
        let frequencies = [];
        
        try {
            const data = await this.api.getFrequencies();
            if (data?.frequencies) {
                frequencies = data.frequencies.map(f => f.frequency);
            }
        } catch (error) {
            console.error('Error loading frequencies:', error);
        }
        
        this.state.frequencies = frequencies;
        
        container.innerHTML = '';
        
        const allTab = document.createElement('button');
        allTab.className = 'sub-tab active';
        allTab.dataset.freq = 'all';
        allTab.textContent = 'Все частоты';
        container.appendChild(allTab);
        
        frequencies.forEach(freq => {
            const tab = document.createElement('button');
            tab.className = 'sub-tab';
            tab.dataset.freq = freq;
            tab.textContent = freq;
            container.appendChild(tab);
        });
        
        this.initSubTabs();
    }
    
    initSubTabs() {
        const subTabs = document.querySelectorAll('.sub-tab');
        
        subTabs.forEach(tab => {
            tab.addEventListener('click', () => {
                subTabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.state.currentFrequency = tab.dataset.freq;
                this.loadChoicesData();
            });
        });
    }
    
    async loadStatisticsData() {
        this.utils.showLoading('statistics');
        
        try {
            const [usersData, dialoguesData, choicesData] = await Promise.all([
                this.api.getUsers().catch(() => null),
                this.api.getDialoguesCount().catch(() => null),
                this.api.getChoiceStatistics().catch(() => null)
            ]);
            
            if (usersData?.users) {
                document.getElementById('total-users').textContent = usersData.users.length;
            }
            
            if (dialoguesData?.count !== undefined) {
                document.getElementById('total-dialogues').textContent = dialoguesData.count;
            }
            
            if (choicesData?.statistics) {
                const totalChoices = choicesData.statistics.reduce((sum, s) => sum + (parseInt(s.count) || 0), 0);
                document.getElementById('total-choices').textContent = totalChoices;
                this.chartManager.createFrequencyChart(choicesData.statistics);
                this.chartManager.createChoicesChart(choicesData.statistics);
            }
            
            this.utils.hideLoading('statistics');
            
        } catch (error) {
            console.error('Statistics error:', error);
            this.utils.hideLoading('statistics');
            this.utils.showError('statistics-content', `Ошибка: ${error.message}`);
        }
    }
    
    async loadUsersData() {
        this.utils.showLoading('users');
        
        try {
            const data = await this.api.getUsers();
            
            if (!data?.users) throw new Error('Invalid data');
            
            this.state.users = data.users;
            this.state.totalUserPages = Math.ceil(this.state.users.length / ITEMS_PER_PAGE) || 1;
            
            this.renderUsersTable();
            this.renderUsersPagination();
            this.initUserSearch();
            
            document.getElementById('users-loading').style.display = 'none';
            document.getElementById('users-table').style.display = 'table';
            
        } catch (error) {
            console.error('Users error:', error);
            document.getElementById('users-loading').style.display = 'none';
            document.getElementById('users-table').style.display = 'table';
            document.getElementById('users-table-body').innerHTML = 
                '<tr><td colspan="4" class="text-center">Ошибка загрузки данных</td></tr>';
        }
    }
    
    renderUsersTable(users = null) {
        const tbody = document.getElementById('users-table-body');
        const data = users || this.state.users;
        
        const start = (this.state.currentUserPage - 1) * ITEMS_PER_PAGE;
        const end = Math.min(start + ITEMS_PER_PAGE, data.length);
        const pageUsers = data.slice(start, end);
        
        tbody.innerHTML = pageUsers.length === 0
            ? '<tr><td colspan="4" class="text-center">Пользователи не найдены</td></tr>'
            : pageUsers.map(user => `
                <tr>
                    <td>${escapeHtml(user.id)}</td>
                    <td>${escapeHtml(user.username)}</td>
                    <td>${escapeHtml(this.utils.formatDate(user.created_at))}</td>
                    <td>
                        <button class="btn change-password-btn"
                                data-id="${escapeAttr(user.id)}"
                                data-username="${escapeAttr(user.username)}">
                            Сменить пароль
                        </button>
                        <button class="btn clear-progress-btn"
                                data-id="${escapeAttr(user.id)}"
                                data-username="${escapeAttr(user.username)}">
                            Очистить прохождение
                        </button>
                        <button class="btn btn-danger delete-user-btn"
                                data-id="${escapeAttr(user.id)}"
                                data-username="${escapeAttr(user.username)}">
                            Удалить
                        </button>
                    </td>
                </tr>
            `).join('');
        
        tbody.querySelectorAll('.change-password-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openPasswordModal(btn.dataset.id, btn.dataset.username);
            });
        });
        
        tbody.querySelectorAll('.delete-user-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openDeleteUserModal(btn.dataset.id, btn.dataset.username);
            });
        });
        
        tbody.querySelectorAll('.clear-progress-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.openClearProgressModal(btn.dataset.id, btn.dataset.username);
            });
        });
    }
    
    renderUsersPagination() {
        const container = document.getElementById('users-pagination');
        container.innerHTML = '';
        
        if (this.state.totalUserPages <= 1) return;
        
        const createButton = (text, isDisabled, onClick) => {
            const btn = document.createElement('button');
            btn.className = `pagination-button${isDisabled ? ' disabled' : ''}`;
            btn.innerHTML = text;
            if (!isDisabled && onClick) btn.addEventListener('click', onClick);
            return btn;
        };
        
        container.appendChild(createButton('«', this.state.currentUserPage === 1, () => {
            if (this.state.currentUserPage > 1) {
                this.state.currentUserPage--;
                this.renderUsersTable();
                this.renderUsersPagination();
            }
        }));
        
        const maxVisible = 5;
        let start = Math.max(1, this.state.currentUserPage - Math.floor(maxVisible / 2));
        let end = Math.min(this.state.totalUserPages, start + maxVisible - 1);
        start = Math.max(1, end - maxVisible + 1);
        
        for (let i = start; i <= end; i++) {
            const btn = createButton(i, false, () => {
                this.state.currentUserPage = i;
                this.renderUsersTable();
                this.renderUsersPagination();
            });
            if (i === this.state.currentUserPage) btn.classList.add('active');
            container.appendChild(btn);
        }
        
        container.appendChild(createButton('»', this.state.currentUserPage === this.state.totalUserPages, () => {
            if (this.state.currentUserPage < this.state.totalUserPages) {
                this.state.currentUserPage++;
                this.renderUsersTable();
                this.renderUsersPagination();
            }
        }));
    }
    
    initUserSearch() {
        const input = document.getElementById('user-search');
        if (!input) return;
        
        input.addEventListener('input', (e) => {
            const term = e.target.value.toLowerCase();
            const filtered = term
                ? this.state.users.filter(u => u.username.toLowerCase().includes(term))
                : null;
            this.renderUsersTable(filtered);
        });
    }
    
    openPasswordModal(userId, username) {
        document.getElementById('user-id-input').value = userId;
        document.getElementById('modal-username').textContent = username;
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
        document.getElementById('password-error').style.display = 'none';
        document.getElementById('password-modal').style.display = 'flex';
    }
    
    async changePassword() {
        const userId = document.getElementById('user-id-input').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const errorEl = document.getElementById('password-error');
        
        if (newPassword.length < 6) {
            errorEl.textContent = 'Пароль должен содержать минимум 6 символов';
            errorEl.style.display = 'block';
            return;
        }
        
        if (newPassword !== confirmPassword) {
            errorEl.textContent = 'Пароли не совпадают';
            errorEl.style.display = 'block';
            return;
        }
        
        try {
            await this.api.changePassword(userId, newPassword);
            document.getElementById('password-modal').style.display = 'none';
            this.utils.showSuccess('users-table', 'Пароль успешно изменен');
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
        }
    }
    
    openDeleteUserModal(userId, username) {
        document.getElementById('delete-user-id').value = userId;
        document.getElementById('delete-username').textContent = username;
        document.getElementById('delete-error').style.display = 'none';
        document.getElementById('delete-user-modal').style.display = 'flex';
    }
    
    async deleteUser() {
        const userId = document.getElementById('delete-user-id').value;
        const errorEl = document.getElementById('delete-error');
        
        try {
            await this.api.deleteUser(userId);
            document.getElementById('delete-user-modal').style.display = 'none';
            this.utils.showSuccess('users-table', 'Пользователь удален');
            await this.loadUsersData();
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
        }
    }
    
    async openClearProgressModal(userId, username) {
        document.getElementById('clear-progress-user-id').value = userId;
        document.getElementById('clear-progress-username').textContent = username;
        document.getElementById('clear-progress-error').style.display = 'none';
        
        const select = document.getElementById('clear-frequency');
        select.innerHTML = '<option value="">Загрузка...</option>';
        document.getElementById('clear-progress-modal').style.display = 'flex';
        
        try {
            const data = await this.api.getFrequencies();
            if (data?.frequencies?.length) {
                select.innerHTML = '<option value="all">Очистить все</option>' +
                    data.frequencies.map(f =>
                    `<option value="${escapeAttr(f.frequency)}">${escapeHtml(f.frequency)}${f.title ? ' - ' + escapeHtml(f.title) : ''}</option>`
                ).join('');
            } else {
                select.innerHTML = '<option value="">Нет диалогов</option>';
            }
        } catch (error) {
            select.innerHTML = '<option value="">Ошибка загрузки</option>';
        }
    }
    
    async clearProgress() {
        const userId = document.getElementById('clear-progress-user-id').value;
        const frequency = document.getElementById('clear-frequency').value;
        const errorEl = document.getElementById('clear-progress-error');
        
        if (!frequency) {
            errorEl.textContent = 'Выберите диалог';
            errorEl.style.display = 'block';
            return;
        }
        
        try {
            await this.api.clearProgress(userId, frequency);
            document.getElementById('clear-progress-modal').style.display = 'none';
            this.utils.showSuccess('users-table', 'Прохождение очищено');
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
        }
    }
    
    async loadChoicesData() {
        this.utils.showLoading('choices');
        
        try {
            const data = await this.api.getChoiceStatistics();
            
            if (!data?.statistics) throw new Error('Invalid data');
            
            this.state.choiceStats = data.statistics;
            this.renderChoicesList();
            
            this.utils.hideLoading('choices');
            
        } catch (error) {
            console.error('Choices error:', error);
            this.state.choiceStats = [];
            this.utils.hideLoading('choices');
            document.getElementById('choice-list').innerHTML = 
                '<li class="choice-item">Ошибка загрузки данных</li>';
        }
    }
    
    renderChoicesList() {
        const list = document.getElementById('choice-list');
        
        if (!this.state.choiceStats?.length) {
            list.innerHTML = '<li class="choice-item">Нет данных о выборах</li>';
            return;
        }
        
        const groups = {};
        
        this.state.choiceStats.forEach(stat => {
            if (this.state.currentFrequency !== 'all' && stat.frequency !== this.state.currentFrequency) {
                return;
            }
            
            const key = `${stat.frequency}-${stat.choice_id}`;
            
            if (!groups[key]) {
                groups[key] = {
                    frequency: stat.frequency,
                    choiceId: stat.choice_id,
                    total: 0,
                    options: []
                };
            }
            
            const count = parseInt(stat.count) || 0;
            groups[key].total += count;
            groups[key].options.push({
                optionId: stat.option_id,
                text: stat.choice_text || 'Нет текста',
                count,
                users: stat.users?.split(',') || []
            });
        });
        
        const sorted = Object.values(groups).sort((a, b) => {
            if (a.frequency !== b.frequency) return a.frequency.localeCompare(b.frequency);
            return a.choiceId.localeCompare(b.choiceId);
        });
        
        const frequencyIndices = {};
        sorted.forEach(choice => {
            if (!frequencyIndices[choice.frequency]) {
                frequencyIndices[choice.frequency] = 0;
            }
            frequencyIndices[choice.frequency]++;
            choice.indexInFrequency = frequencyIndices[choice.frequency];
        });
        
        if (!sorted.length) {
            list.innerHTML = '<li class="choice-item">Нет данных для выбранной частоты</li>';
            return;
        }
        
        list.innerHTML = sorted.map(choice => {
            choice.options.sort((a, b) => b.count - a.count);
            
            return `
                <li class="choice-item" data-frequency="${escapeAttr(choice.frequency)}" data-choice="${escapeAttr(choice.choiceId)}">
                    <div class="choice-header">
                        <div class="choice-title">Выборы на частоте: ${escapeHtml(choice.frequency)} #${escapeHtml(choice.indexInFrequency)}</div>
                        <div class="choice-count">${choice.total} выборов</div>
                    </div>
                    <div class="choice-options">
                        ${choice.options.map(opt => {
                            const percent = this.utils.calculatePercent(opt.count, choice.total);
                            return `
                                <div class="choice-option">
                                    <div class="choice-option-text">${escapeHtml(opt.text)}</div>
                                    <div class="choice-option-count">${opt.count}</div>
                                    <div class="choice-option-percent">${percent}%</div>
                                    <div class="progress-bar">
                                        <div class="progress-value" style="width: ${percent}%"></div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <button class="btn detail-btn">Детализация</button>
                </li>
            `;
        }).join('');
        
        list.querySelectorAll('.choice-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.classList.contains('detail-btn')) {
                    item.classList.toggle('expanded');
                }
            });
            
            item.querySelector('.detail-btn')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.openChoiceDetails(item.dataset.frequency, item.dataset.choice);
            });
        });
    }
    
    async openChoiceDetails(frequency, choiceId) {
        const modal = document.getElementById('choice-details-modal');
        modal.style.display = 'flex';
        
        document.getElementById('detail-frequency').textContent = frequency;
        
        document.getElementById('choice-details-loading').style.display = 'flex';
        document.getElementById('choice-details-content').style.display = 'none';
        
        try {
            const data = await this.api.getChoiceDetails(frequency, choiceId);
            
            if (!data?.details) throw new Error('Invalid data');
            
            this.renderChoiceDetails(data.details);
            
        } catch (error) {
            console.error('Details error:', error);
            document.getElementById('detail-options').textContent = `Ошибка: ${error.message}`;
            document.getElementById('choice-details-loading').style.display = 'none';
            document.getElementById('choice-details-content').style.display = 'block';
        }
    }
    
    renderChoiceDetails(details) {
        const optionsContainer = document.getElementById('detail-options');
        const tableBody = document.getElementById('detail-users-table');
        
        optionsContainer.innerHTML = '';
        tableBody.innerHTML = '';
        
        const optionGroups = {};
        
        details.forEach(detail => {
            if (!optionGroups[detail.option_id]) {
                optionGroups[detail.option_id] = {
                    optionId: detail.option_id,
                    text: detail.choice_text,
                    users: [],
                    count: 0
                };
            }
            
            optionGroups[detail.option_id].users.push({
                username: detail.username,
                createdAt: detail.created_at
            });
            optionGroups[detail.option_id].count++;
        });
        
        const sorted = Object.values(optionGroups).sort((a, b) => b.count - a.count);
        
        sorted.forEach(option => {
            const div = document.createElement('div');
            div.innerHTML = `<strong>${escapeHtml(option.text)} (${escapeHtml(option.count)} выборов)</strong>`;
            optionsContainer.appendChild(div);
        });

        this.chartManager.createDetailChart(sorted);

        tableBody.innerHTML = details.map(detail => `
            <tr>
                <td>${escapeHtml(detail.username)}</td>
                <td>${escapeHtml(detail.choice_text)}</td>
                <td>${escapeHtml(this.utils.formatDate(detail.created_at))}</td>
            </tr>
        `).join('');
        
        document.getElementById('choice-details-loading').style.display = 'none';
        document.getElementById('choice-details-content').style.display = 'block';
    }
    
    async loadProgressData() {
        this.utils.showLoading('progress');
        
        try {
            const data = await this.api.getUserProgress();
            
            if (!data?.progress) throw new Error('Invalid data');
            
            this.state.progressData = data.progress;
            this.renderProgressData();
            
            this.utils.hideLoading('progress');
            
        } catch (error) {
            console.error('Progress error:', error);
            this.state.progressData = [];
            this.utils.hideLoading('progress');
            document.getElementById('progress-table-body').innerHTML = 
                '<tr><td colspan="4" class="text-center">Ошибка загрузки данных</td></tr>';
        }
    }
    
    renderProgressData() {
        const tbody = document.getElementById('progress-table-body');
        
        if (!this.state.progressData?.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">Нет данных о прогрессе</td></tr>';
            return;
        }
        
        const sorted = [...this.state.progressData].sort((a, b) => {
            if (a.username !== b.username) return a.username.localeCompare(b.username);
            return a.frequency.localeCompare(b.frequency);
        });
        
        tbody.innerHTML = sorted.map(progress => {
            const maxRepeats = progress.max_repeats || 1;
            const repeatCount = progress.repeat_count || 0;
            
            let statusClass = '';
            if (progress.status === 'Не начато') statusClass = 'status-not-started';
            else if (progress.status === 'В процессе') statusClass = 'status-in-progress';
            else if (progress.status === 'Да') statusClass = 'status-completed';
            else if (progress.status === 'Да (перепрохождение)') statusClass = 'status-replay';
            
            return `
                <tr>
                    <td>${escapeHtml(progress.username)}</td>
                    <td>${escapeHtml(progress.frequency)}</td>
                    <td>${escapeHtml(repeatCount)} / ${escapeHtml(maxRepeats)}</td>
                    <td><span class="status-badge ${statusClass}">${escapeHtml(progress.status)}</span></td>
                </tr>
            `;
        }).join('');
        
        this.chartManager.createProgressChart(this.state.progressData);
    }
    
    async logout() {
        try {
            await this.api.logout();
            window.location.href = 'index.html';
        } catch (error) {
            console.error('Logout error:', error);
            alert('Ошибка при выходе');
        }
    }

    // Подсветка несохранённых изменений (жёлтый) и снятие её после сохранения.
    markRelDirty(input) {
        input.style.borderColor = '#ffcc00';
        input.style.boxShadow = '0 0 5px rgba(255, 204, 0, 0.6)';
    }

    markRelClean(input) {
        input.style.borderColor = '';
        input.style.boxShadow = '';
    }

    async loadRelationsData() {
        const loading = document.getElementById('relations-loading');
        const userList = document.getElementById('relations-user-list');
        if (loading) loading.style.display = 'flex';
        if (userList) userList.innerHTML = '';

        try {
            const response = await fetch(`${AppConfig.API_URL}/editor/global-characters/relations`, {
                credentials: 'include',
                headers: AppConfig.CACHE_HEADERS
            });
            const data = await response.json();
            this._relationsData = data;

            const users = data?.users || [];
            const empty = document.getElementById('relations-user-empty');
            if (!users.length) {
                if (empty) empty.style.display = 'block';
            } else if (userList) {
                userList.innerHTML = users.map(u => `
                    <button class="btn relations-user-btn" data-user-id="${escapeAttr(u.id)}"
                            style="display:block;width:100%;text-align:left;margin:0 0 4px 0;border:none;border-bottom:1px solid var(--primary-border);padding:7px 10px;font-size:12px;">
                        ${escapeHtml(u.username)}
                    </button>
                `).join('');
                userList.querySelectorAll('.relations-user-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        userList.querySelectorAll('.relations-user-btn').forEach(b => {
                            b.style.backgroundColor = '';
                            b.style.color = '';
                        });
                        btn.style.backgroundColor = 'var(--primary-bg)';
                        btn.style.color = 'var(--primary-color)';
                        this.renderRelationsForUser(parseInt(btn.dataset.userId));
                    });
                });
            }
        } catch (error) {
            console.error('Relations error:', error);
            if (userList) userList.innerHTML = '<div style="color:#ff3333;font-size:12px;">Ошибка загрузки</div>';
        }
        if (loading) loading.style.display = 'none';
    }

    // Отношения выбранного пользователя с NPC: строка на NPC, клик раскрывает пилотов.
    renderRelationsForUser(userId) {
        const data = this._relationsData || { relations: [] };
        const tbody = document.getElementById('relations-table-body');
        const table = document.getElementById('relations-table');
        const placeholder = document.getElementById('relations-placeholder');
        if (!tbody) return;

        // Группируем отношения пользователя по персонажу; стартовое значение — строка пилота 0
        const byChar = {};
        data.relations.filter(r => r.user_id === userId).forEach(r => {
            if (!byChar[r.global_character_id] || r.pilot_profile_id === 0) {
                byChar[r.global_character_id] = r;
            }
        });
        const rows = Object.values(byChar);

        if (placeholder) placeholder.style.display = 'none';
        if (table) table.style.display = 'table';

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">У игрока пока нет записей об отношениях (задайте их через каталог персонажей).</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(r => {
            const val = r.relation_value;
            const color = val < -30 ? '#ff4444' : val < 0 ? '#ff9500' : 'var(--primary-color)';
            const barPercent = ((val + 100) / 200) * 100;
            const barStyle = val >= 0
                ? `left:50%;width:${barPercent - 50}%;background-color:${color};`
                : `left:${barPercent}%;width:${50 - barPercent}%;background-color:${color};`;

            return `<tr class="rel-char-row" data-user-id="${escapeAttr(userId)}" data-gc-id="${escapeAttr(r.global_character_id)}" style="cursor:pointer;">
                <td>
                    <span class="rel-toggle" style="display:inline-block;width:14px;color:var(--primary-color);">▸</span>
                    ${escapeHtml(r.character_name)}
                </td>
                <td>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="number" class="form-input rel-edit-input" value="${val}" min="-100" max="100" step="5" style="width:70px;font-size:12px;padding:3px 6px;">
                        <div style="flex:1;height:6px;background:#333;border-radius:3px;position:relative;overflow:hidden;min-width:60px;">
                            <div style="height:100%;position:absolute;top:0;${barStyle}"></div>
                        </div>
                        <span style="font-size:11px;min-width:30px;text-align:right;color:${color};">${val > 0 ? '+' : ''}${val}</span>
                    </div>
                    <div style="font-size:10px;color:#888;margin-top:3px;">Применяется ко всем пилотам аккаунта</div>
                </td>
                <td>
                    <button class="btn rel-save-btn" style="font-size:11px;padding:3px 8px;">Сохранить</button>
                </td>
            </tr>
            <tr class="rel-pilots-row" data-user-id="${escapeAttr(userId)}" style="display:none;">
                <td colspan="3" class="rel-pilots-cell" style="padding:4px 10px;background:rgba(128,128,128,0.06);"></td>
            </tr>`;
        }).join('');

        // Сохранение стартового / глобального значения
        tbody.querySelectorAll('.rel-save-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const row = btn.closest('tr');
                const uid = row.dataset.userId;
                const gcId = row.dataset.gcId;
                const input = row.querySelector('.rel-edit-input');
                const val = Math.max(-100, Math.min(100, parseInt(input.value) || 0));
                input.value = val;
                try {
                    await fetch(`${AppConfig.API_URL}/editor/global-characters/${gcId}/user/${uid}/relation`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ relationValue: val, global: true })
                    });
                    this.markRelClean(input);
                    btn.textContent = 'OK';
                    setTimeout(() => { btn.textContent = 'Сохранить'; }, 1000);
                } catch (err) {
                    alert('Ошибка сохранения');
                }
            });
        });

        // Жёлтая подсветка несохранённых изменений
        tbody.querySelectorAll('.rel-edit-input').forEach(input => {
            input.addEventListener('input', () => this.markRelDirty(input));
        });

        // Раскрытие пилотов по клику на строку NPC
        tbody.querySelectorAll('.rel-char-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('input, button, label')) return;
                this.toggleAdminRelationsPilots(row);
            });
            row.querySelector('.rel-toggle')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleAdminRelationsPilots(row);
            });
        });
    }

    // Раскрыть/свернуть список пилотов для строки NPC во вкладке «Отношения».
    async toggleAdminRelationsPilots(charRow) {
        const userId = parseInt(charRow.dataset.userId);
        const gcId = charRow.dataset.gcId;
        const pilotsRow = charRow.nextElementSibling;
        if (!pilotsRow || !pilotsRow.classList.contains('rel-pilots-row')) return;
        const cell = pilotsRow.querySelector('.rel-pilots-cell');
        const toggle = charRow.querySelector('.rel-toggle');

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
            const [pilotsRes] = await Promise.all([
                fetch(`${AppConfig.API_URL}/editor/users/${userId}/pilots`, {
                    credentials: 'include',
                    headers: AppConfig.CACHE_HEADERS
                })
            ]);
            const pilotsData = await pilotsRes.json();
            const pilots = pilotsData.pilots || [];
            const rels = (this._relationsData?.relations || []).filter(r =>
                r.user_id === userId && r.global_character_id === gcId);

            if (pilots.length === 0) {
                cell.innerHTML = '<span style="font-size:11px;color:#888;">У игрока нет пилотов.</span>';
                cell.dataset.loaded = '1';
                return;
            }

            const baseVal = parseInt(charRow.querySelector('.rel-edit-input')?.value) || 0;
            cell.innerHTML = pilots.map(p => {
                const rel = rels.find(r => r.pilot_profile_id === p.id);
                const value = rel ? rel.relation_value : baseVal;
                const color = value > 0 ? 'var(--primary-color)' : value < 0 ? '#ff3333' : 'inherit';
                const activeMark = p.is_active ? ' <span style="color:var(--primary-color);font-size:10px;">● активен</span>' : '';
                return `
                    <div class="rel-pilot-item" data-user-id="${escapeAttr(userId)}" data-gc-id="${escapeAttr(gcId)}"
                         data-pilot-id="${escapeAttr(p.id)}" style="display:flex;align-items:center;gap:8px;padding:4px 0 4px 16px;border-bottom:1px dashed var(--primary-border);">
                        <span style="min-width:150px;font-size:12px;">${escapeHtml(p.callsign || ('Пилот ' + p.slot_number))}${activeMark}</span>
                        <input type="number" class="form-input rel-pilot-value-input" value="${escapeAttr(value)}"
                               min="-100" max="100" step="5" style="width:70px;font-size:12px;padding:3px 6px;color:${color};text-align:center;">
                        <button class="btn btn-small rel-pilot-save-btn" style="font-size:11px;padding:3px 8px;">✓</button>
                    </div>
                `;
            }).join('');

            cell.querySelectorAll('.rel-pilot-value-input').forEach(input => {
                input.addEventListener('input', () => this.markRelDirty(input));
            });
            cell.querySelectorAll('.rel-pilot-save-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const item = btn.closest('.rel-pilot-item');
                    const input = item.querySelector('.rel-pilot-value-input');
                    const val = Math.max(-100, Math.min(100, parseInt(input.value) || 0));
                    input.value = val;
                    try {
                        await fetch(`${AppConfig.API_URL}/editor/global-characters/${item.dataset.gcId}/user/${item.dataset.userId}/relation`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({ relationValue: val, pilotProfileId: parseInt(item.dataset.pilotId) })
                        });
                        this.markRelClean(input);
                        btn.textContent = '✓';
                        btn.style.color = 'var(--primary-color)';
                        setTimeout(() => { btn.textContent = '✓'; btn.style.color = ''; }, 1000);
                    } catch (err) {
                        alert('Ошибка сохранения');
                    }
                });
            });
            cell.dataset.loaded = '1';
        } catch (err) {
            console.error('Error loading pilots:', err);
            cell.innerHTML = '<span style="font-size:11px;color:#ff3333;">Ошибка загрузки пилотов</span>';
        }
    }

    // ===== Вкладка «Музыка» =====
    get musicTheme() {
        return document.getElementById('music-theme-select')?.value || 'yellow';
    }

    get musicServerOrigin() {
        return AppConfig.API_URL.replace(/\/api$/, '');
    }

    async loadMusicData() {
        const loading = document.getElementById('music-loading');
        const tbody = document.getElementById('music-table-body');
        const empty = document.getElementById('music-empty');
        if (!tbody) return;
        if (loading) loading.style.display = 'flex';
        tbody.innerHTML = '';

        try {
            const response = await fetch(`${AppConfig.API_URL}/admin/music`, {
                credentials: 'include',
                headers: AppConfig.CACHE_HEADERS
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const tracks = (data?.tracks || []).filter(t => t.theme === this.musicTheme);
            this._musicTracks = tracks;
            if (empty) empty.style.display = tracks.length ? 'none' : 'block';
            this.renderMusicTable(tracks);
        } catch (error) {
            console.error('Music error:', error);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Ошибка загрузки</td></tr>';
        }
        if (loading) loading.style.display = 'none';
    }

    renderMusicTable(tracks) {
        const tbody = document.getElementById('music-table-body');
        if (!tbody) return;

        tbody.innerHTML = tracks.map(t => `
            <tr data-track-id="${escapeAttr(t.id)}">
                <td>${escapeHtml(t.title)}</td>
                <td>
                    <input type="number" class="form-input music-vol-input" value="${Number(t.volume)}" min="0" max="100" step="5" style="width:70px;font-size:12px;padding:3px 6px;">
                    <span style="font-size:11px;color:#888;">%</span>
                </td>
                <td>
                    <button class="btn music-preview-btn" style="font-size:11px;padding:3px 8px;">▶</button>
                </td>
                <td>
                    <button class="btn music-del-btn" style="font-size:11px;padding:3px 8px;">Удалить</button>
                </td>
            </tr>
        `).join('');

        // Автосохранение громкости
        tbody.querySelectorAll('.music-vol-input').forEach(input => {
            input.addEventListener('change', async () => {
                const row = input.closest('tr');
                const id = row.dataset.trackId;
                let vol = Math.max(0, Math.min(100, parseInt(input.value) || 0));
                input.value = vol;
                try {
                    await fetch(`${AppConfig.API_URL}/admin/music/${id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'include',
                        body: JSON.stringify({ volume: vol })
                    });
                    input.style.borderColor = '#03FB8D';
                    setTimeout(() => { input.style.borderColor = ''; }, 800);
                } catch (e) {
                    alert('Ошибка сохранения громкости');
                }
            });
        });

        // Прослушка / остановка (один общий аудио-объект)
        if (!this._previewAudio) this._previewAudio = new Audio();
        tbody.querySelectorAll('.music-preview-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const row = btn.closest('tr');
                const id = row.dataset.trackId;
                const track = (this._musicTracks || []).find(t => String(t.id) === String(id));
                if (!track) return;
                const url = /^https?:/.test(track.file_path)
                    ? track.file_path
                    : this.musicServerOrigin + track.file_path;

                // Обновляем иконки всех кнопок
                const resetIcons = () => {
                    tbody.querySelectorAll('.music-preview-btn').forEach(b => { b.textContent = '▶'; });
                };

                if (this._previewAudio.src === url && !this._previewAudio.paused) {
                    this._previewAudio.pause();
                    this._previewAudio.currentTime = 0;
                    resetIcons();
                    return;
                }

                this._previewAudio.pause();
                this._previewAudio.src = url;
                this._previewAudio.volume = Math.max(0, Math.min(100, Number(track.volume) || 100)) / 100;
                this._previewAudio.play().catch(e => alert('Не удалось воспроизвести: ' + e.message));
                resetIcons();
                btn.textContent = '⏹';
            });
        });
        this._previewAudio?.addEventListener('ended', () => {
            tbody.querySelectorAll('.music-preview-btn').forEach(b => { b.textContent = '▶'; });
        });

        // Удаление трека
        tbody.querySelectorAll('.music-del-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                const id = row.dataset.trackId;
                if (!confirm('Удалить трек из плейлиста?')) return;
                try {
                    await fetch(`${AppConfig.API_URL}/admin/music/${id}`, {
                        method: 'DELETE',
                        credentials: 'include'
                    });
                    this.loadMusicData();
                } catch (e) {
                    alert('Ошибка удаления');
                }
            });
        });
    }

    initMusicTab() {
        const themeSelect = document.getElementById('music-theme-select');
        const fileInput = document.getElementById('music-file-input');
        const uploadBtn = document.getElementById('music-upload-btn');
        const status = document.getElementById('music-upload-status');

        themeSelect?.addEventListener('change', () => this.loadMusicData());

        uploadBtn?.addEventListener('click', () => fileInput?.click());

        fileInput?.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;
            if (status) status.textContent = 'Загрузка...';
            try {
                const title = file.name.replace(/\.[^.]+$/, '');
                const formData = new FormData();
                formData.append('music', file);
                formData.append('theme', this.musicTheme);
                formData.append('title', title);
                const response = await fetch(`${AppConfig.API_URL}/admin/music/upload`, {
                    method: 'POST',
                    credentials: 'include',
                    body: formData
                });
                if (!response.ok) {
                    const err = await response.json().catch(() => ({}));
                    throw new Error(err.message || err.error || `HTTP ${response.status}`);
                }
                if (status) status.textContent = 'Трек загружен.';
                fileInput.value = '';
                this.loadMusicData();
            } catch (e) {
                if (status) status.textContent = 'Ошибка: ' + e.message;
            }
            setTimeout(() => { if (status) status.textContent = ''; }, 5000);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new AdminApp();
    app.init();
});
