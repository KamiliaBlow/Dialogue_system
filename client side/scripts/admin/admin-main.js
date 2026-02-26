import AppConfig from '../config.js';
import AdminAPI from './admin-api.js';
import ChartManager from './admin-charts.js';
import AdminUtils from './admin-utils.js';

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
            progress: () => this.loadProgressData()
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
        const frequencies = await this.utils.loadFrequenciesFromConfig();
        this.state.frequencies = frequencies;
        
        const container = document.querySelector('.sub-tabs');
        if (!container) return;
        
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
            const [usersData, choicesData, progressData] = await Promise.all([
                this.api.getUsers().catch(() => null),
                this.api.getChoiceStatistics().catch(() => null),
                this.api.getUserProgress().catch(() => null)
            ]);
            
            if (usersData?.users) {
                document.getElementById('total-users').textContent = usersData.users.length;
            }
            
            if (choicesData?.statistics) {
                document.getElementById('total-choices').textContent = choicesData.statistics.length;
                this.chartManager.createFrequencyChart(choicesData.statistics);
                this.chartManager.createChoicesChart(choicesData.statistics);
            }
            
            if (progressData?.progress) {
                const completed = progressData.progress.filter(p => p.completed).length;
                document.getElementById('completed-dialogues').textContent = completed;
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
                    <td>${user.id}</td>
                    <td>${user.username}</td>
                    <td>${this.utils.formatDate(user.created_at)}</td>
                    <td>
                        <button class="btn change-password-btn" 
                                data-id="${user.id}" 
                                data-username="${user.username}">
                            Сменить пароль
                        </button>
                        <button class="btn clear-progress-btn" 
                                data-id="${user.id}" 
                                data-username="${user.username}">
                            Очистить прохождение
                        </button>
                        <button class="btn btn-danger delete-user-btn" 
                                data-id="${user.id}" 
                                data-username="${user.username}">
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
                select.innerHTML = data.frequencies.map(f => 
                    `<option value="${f.frequency}">${f.frequency}${f.title ? ' - ' + f.title : ''}</option>`
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
        
        if (!sorted.length) {
            list.innerHTML = '<li class="choice-item">Нет данных для выбранной частоты</li>';
            return;
        }
        
        list.innerHTML = sorted.map(choice => {
            choice.options.sort((a, b) => b.count - a.count);
            
            return `
                <li class="choice-item" data-frequency="${choice.frequency}" data-choice="${choice.choiceId}">
                    <div class="choice-header">
                        <div class="choice-title">${choice.frequency}: ${choice.choiceId}</div>
                        <div class="choice-count">${choice.total} выборов</div>
                    </div>
                    <div class="choice-options">
                        ${choice.options.map(opt => {
                            const percent = this.utils.calculatePercent(opt.count, choice.total);
                            return `
                                <div class="choice-option">
                                    <div class="choice-option-text">${opt.text}</div>
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
        document.getElementById('detail-choice-id').textContent = choiceId;
        
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
            div.innerHTML = `<strong>${option.text} (${option.count} выборов)</strong>`;
            optionsContainer.appendChild(div);
        });
        
        this.chartManager.createDetailChart(sorted);
        
        tableBody.innerHTML = details.map(detail => `
            <tr>
                <td>${detail.username}</td>
                <td>${detail.choice_text}</td>
                <td>${this.utils.formatDate(detail.created_at)}</td>
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
            const percent = Math.max(0, Math.min(100, this.utils.parseProgress(progress.progress)));
            
            return `
                <tr>
                    <td>${progress.username}</td>
                    <td>${progress.frequency}</td>
                    <td>
                        <div style="width: 100%; background: rgba(3, 251, 141, 0.1); height: 10px;">
                            <div style="width: ${percent}%; background: #03FB8D; height: 100%;"></div>
                        </div>
                        <div style="text-align: center; margin-top: 5px;">${percent}% (${progress.progress || '0'})</div>
                    </td>
                    <td>${progress.completed ? 'Да' : 'Нет'}</td>
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
}

document.addEventListener('DOMContentLoaded', () => {
    const app = new AdminApp();
    app.init();
});
