// Панель администратора: Обзор · Игроки · Музыка.
// Шапка, права, тема и выход — admin-shell.js; запросы — admin-api.js.
import { relationColor, formatRelation } from '../relation-colors.js';
import AppConfig from '../config.js';
import api from './admin-api.js';
import ChartManager from './admin-charts.js';
import AdminUtils from './admin-utils.js';
import { escapeHtml, escapeAttr } from '../escape-utils.js';
import { initShell, toast } from './admin-shell.js';

const { ITEMS_PER_PAGE } = AppConfig;
const TABS = ['overview', 'players', 'music'];
// Старые адреса вкладок ведут в новые разделы.
const LEGACY_TABS = { statistics: 'overview', choices: 'overview', progress: 'overview', users: 'players', relations: 'players' };

class AdminApp {
    constructor() {
        this.state = {
            users: [],
            filteredUsers: null,
            currentUserPage: 1,
            totalUserPages: 1,
            choiceStats: [],
            currentFrequency: 'all',
            progressData: [],
            frequencies: [],
            selectedUserId: null
        };
        this.relationsData = null;
        this.loaded = new Set();
        this.chartManager = new ChartManager();
        this.utils = AdminUtils;
    }

    async init() {
        const auth = await initShell({ page: 'panel', title: 'ПАНЕЛЬ' });
        if (!auth) return;

        this.initTabs();
        this.initModals();
        this.initMusicTab();
        this.initUserSearch();
        this.openTab(this.tabFromHash(), { replace: true });
        window.addEventListener('hashchange', () => this.openTab(this.tabFromHash(), { replace: true }));
    }

    tabFromHash() {
        const raw = location.hash.replace('#', '');
        const tab = LEGACY_TABS[raw] || raw;
        return TABS.includes(tab) ? tab : 'overview';
    }

    initTabs() {
        document.querySelectorAll('.admin-tabs .admin-tab').forEach(tab => {
            tab.addEventListener('click', () => this.openTab(tab.dataset.tab));
        });
    }

    openTab(tabName, { replace = false } = {}) {
        document.querySelectorAll('.admin-tabs .admin-tab').forEach(t => {
            const active = t.dataset.tab === tabName;
            t.classList.toggle('active', active);
            t.setAttribute('aria-selected', String(active));
        });
        document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.id === tabName));
        if (!replace || location.hash.replace('#', '') !== tabName) {
            history.replaceState(null, '', `#${tabName}`);
        }
        this.loadTabData(tabName);
    }

    async loadTabData(tabName) {
        const loaders = {
            overview: async () => {
                this.loadStatisticsData();
                await this.updateFrequencyTabs();
                this.loadChoicesData();
                this.loadProgressData();
            },
            players: async () => {
                await this.loadUsersData();
                if (!this.state.progressData.length) await this.loadProgressData();
            },
            music: () => this.loadMusicData()
        };
        await loaders[tabName]?.();
    }

    initModals() {
        const modals = ['password-modal', 'choice-details-modal', 'delete-user-modal', 'clear-progress-modal', 'rename-user-modal', 'pilot-modal']
            .map(id => document.getElementById(id));
        const close = id => { document.getElementById(id).style.display = 'none'; };

        document.getElementById('cancel-password')?.addEventListener('click', () => close('password-modal'));
        document.getElementById('save-password')?.addEventListener('click', () => this.changePassword());
        document.getElementById('close-details')?.addEventListener('click', () => close('choice-details-modal'));
        document.getElementById('cancel-delete')?.addEventListener('click', () => close('delete-user-modal'));
        document.getElementById('confirm-delete')?.addEventListener('click', () => this.deleteUser());
        document.getElementById('cancel-clear')?.addEventListener('click', () => close('clear-progress-modal'));
        document.getElementById('confirm-clear')?.addEventListener('click', () => this.clearProgress());
        document.getElementById('cancel-rename')?.addEventListener('click', () => close('rename-user-modal'));
        document.getElementById('confirm-rename')?.addEventListener('click', () => this.renameUser());
        document.getElementById('rename-username')?.addEventListener('keydown', e => { if (e.key === 'Enter') this.renameUser(); });
        document.getElementById('cancel-pilot')?.addEventListener('click', () => close('pilot-modal'));
        document.getElementById('save-pilot')?.addEventListener('click', () => this.savePilot());
        this.initPilotForm();

        window.addEventListener('click', e => {
            modals.forEach(m => { if (e.target === m) m.style.display = 'none'; });
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') modals.forEach(m => { m.style.display = 'none'; });
        });
    }

    // ===================== ОБЗОР =====================

    async updateFrequencyTabs() {
        const container = document.querySelector('.sub-tabs');
        if (!container) return;

        let frequencies = [];
        try {
            const data = await api.getFrequencies();
            frequencies = (data?.frequencies || []).map(f => f.frequency);
        } catch (error) {
            console.error('Error loading frequencies:', error);
        }
        this.state.frequencies = frequencies;

        container.textContent = '';
        ['all', ...frequencies].forEach(freq => {
            const tab = document.createElement('button');
            tab.className = `sub-tab${freq === this.state.currentFrequency ? ' active' : ''}`;
            tab.dataset.freq = freq;
            tab.textContent = freq === 'all' ? 'Все частоты' : freq;
            tab.addEventListener('click', () => {
                container.querySelectorAll('.sub-tab').forEach(t => t.classList.toggle('active', t === tab));
                this.state.currentFrequency = freq;
                this.renderChoicesList();
            });
            container.appendChild(tab);
        });
    }

    async loadStatisticsData() {
        this.utils.showLoading('statistics');
        try {
            const [usersData, dialoguesData, choicesData] = await Promise.all([
                api.getUsers().catch(() => null),
                api.getDialoguesCount().catch(() => null),
                api.getChoiceStatistics().catch(() => null)
            ]);

            if (usersData?.users) document.getElementById('total-users').textContent = usersData.users.length;
            if (dialoguesData?.count !== undefined) document.getElementById('total-dialogues').textContent = dialoguesData.count;
            if (choicesData?.statistics) {
                const totalChoices = choicesData.statistics.reduce((sum, s) => sum + (parseInt(s.count) || 0), 0);
                document.getElementById('total-choices').textContent = totalChoices;
                this.chartManager.createFrequencyChart(choicesData.statistics);
                this.chartManager.createChoicesChart(choicesData.statistics);
            }
        } catch (error) {
            console.error('Statistics error:', error);
            this.utils.showError('statistics-content', `Ошибка: ${error.message}`);
        }
        this.utils.hideLoading('statistics');
    }

    async loadChoicesData() {
        this.utils.showLoading('choices');
        try {
            const data = await api.getChoiceStatistics();
            this.state.choiceStats = data?.statistics || [];
            this.renderChoicesList();
        } catch (error) {
            console.error('Choices error:', error);
            this.state.choiceStats = [];
            document.getElementById('choice-list').innerHTML = '<li class="choice-item">Ошибка загрузки данных</li>';
        }
        this.utils.hideLoading('choices');
    }

    renderChoicesList() {
        const list = document.getElementById('choice-list');
        if (!this.state.choiceStats?.length) {
            list.innerHTML = '<li class="choice-item">Нет данных о выборах</li>';
            return;
        }

        const groups = {};
        this.state.choiceStats.forEach(stat => {
            if (this.state.currentFrequency !== 'all' && stat.frequency !== this.state.currentFrequency) return;
            const key = `${stat.frequency}-${stat.choice_id}`;
            if (!groups[key]) groups[key] = { frequency: stat.frequency, choiceId: stat.choice_id, total: 0, options: [] };
            const count = parseInt(stat.count) || 0;
            groups[key].total += count;
            groups[key].options.push({ optionId: stat.option_id, text: stat.choice_text || 'Нет текста', count });
        });

        const sorted = Object.values(groups).sort((a, b) =>
            a.frequency !== b.frequency ? a.frequency.localeCompare(b.frequency) : a.choiceId.localeCompare(b.choiceId));
        const perFrequency = {};
        sorted.forEach(choice => {
            perFrequency[choice.frequency] = (perFrequency[choice.frequency] || 0) + 1;
            choice.indexInFrequency = perFrequency[choice.frequency];
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
                                    <div class="progress-bar"><div class="progress-value" style="width: ${percent}%"></div></div>
                                </div>`;
                        }).join('')}
                    </div>
                    <button class="btn detail-btn">Детализация</button>
                </li>`;
        }).join('');

        list.querySelectorAll('.choice-item').forEach(item => {
            item.addEventListener('click', e => {
                if (!e.target.classList.contains('detail-btn')) item.classList.toggle('expanded');
            });
            item.querySelector('.detail-btn')?.addEventListener('click', e => {
                e.stopPropagation();
                this.openChoiceDetails(item.dataset.frequency, item.dataset.choice);
            });
        });
    }

    async openChoiceDetails(frequency, choiceId) {
        document.getElementById('choice-details-modal').style.display = 'flex';
        document.getElementById('detail-frequency').textContent = frequency;
        document.getElementById('choice-details-loading').style.display = 'flex';
        document.getElementById('choice-details-content').style.display = 'none';

        try {
            const data = await api.getChoiceDetails(frequency, choiceId);
            if (!data?.details) throw new Error('Некорректный ответ сервера');
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
        optionsContainer.textContent = '';

        const groups = {};
        details.forEach(d => {
            if (!groups[d.option_id]) groups[d.option_id] = { optionId: d.option_id, text: d.choice_text, users: [], count: 0 };
            groups[d.option_id].users.push({ username: d.username, createdAt: d.created_at });
            groups[d.option_id].count++;
        });
        const sorted = Object.values(groups).sort((a, b) => b.count - a.count);
        sorted.forEach(option => {
            const div = document.createElement('div');
            div.innerHTML = `<strong>${escapeHtml(option.text)} (${escapeHtml(option.count)} выборов)</strong>`;
            optionsContainer.appendChild(div);
        });
        this.chartManager.createDetailChart(sorted);

        tableBody.innerHTML = details.map(d => `
            <tr>
                <td>${escapeHtml(d.username)}</td>
                <td>${escapeHtml(d.choice_text)}</td>
                <td>${escapeHtml(this.utils.formatDate(d.created_at))}</td>
            </tr>`).join('');

        document.getElementById('choice-details-loading').style.display = 'none';
        document.getElementById('choice-details-content').style.display = 'block';
    }

    async loadProgressData() {
        this.utils.showLoading('progress');
        try {
            const data = await api.getUserProgress();
            this.state.progressData = data?.progress || [];
            this.renderProgressData();
        } catch (error) {
            console.error('Progress error:', error);
            this.state.progressData = [];
            document.getElementById('progress-table-body').innerHTML =
                '<tr><td colspan="4" class="text-center">Ошибка загрузки данных</td></tr>';
        }
        this.utils.hideLoading('progress');
        if (this.state.selectedUserId !== null) this.renderPlayerProgress();
    }

    statusClass(status) {
        return {
            'Не начато': 'status-not-started',
            'В процессе': 'status-in-progress',
            'Да': 'status-completed',
            'Да (перепрохождение)': 'status-replay'
        }[status] || '';
    }

    renderProgressData() {
        const tbody = document.getElementById('progress-table-body');
        if (!this.state.progressData?.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">Нет данных о прогрессе</td></tr>';
            return;
        }
        const sorted = [...this.state.progressData].sort((a, b) =>
            a.username !== b.username ? a.username.localeCompare(b.username) : a.frequency.localeCompare(b.frequency));
        tbody.innerHTML = sorted.map(p => `
            <tr>
                <td>${escapeHtml(p.username)}</td>
                <td>${escapeHtml(p.frequency)}</td>
                <td>${escapeHtml(p.repeat_count || 0)} / ${escapeHtml(p.max_repeats || 1)}</td>
                <td><span class="status-badge ${this.statusClass(p.status)}">${escapeHtml(p.status)}</span></td>
            </tr>`).join('');
        this.chartManager.createProgressChart(this.state.progressData);
    }

    // ===================== ИГРОКИ =====================

    async loadUsersData() {
        document.getElementById('users-loading').style.display = 'flex';
        try {
            const data = await api.getUsers();
            this.state.users = data?.users || [];
            this.applyUserFilter();
        } catch (error) {
            console.error('Users error:', error);
            document.getElementById('users-table-body').innerHTML =
                '<tr><td colspan="4" class="text-center">Ошибка загрузки данных</td></tr>';
        }
        document.getElementById('users-loading').style.display = 'none';
        document.getElementById('users-table').style.display = 'table';
    }

    applyUserFilter() {
        const term = (document.getElementById('user-search')?.value || '').trim().toLowerCase();
        this.state.filteredUsers = term ? this.state.users.filter(u => u.username.toLowerCase().includes(term)) : null;
        const list = this.state.filteredUsers || this.state.users;
        this.state.totalUserPages = Math.ceil(list.length / ITEMS_PER_PAGE) || 1;
        this.state.currentUserPage = Math.min(this.state.currentUserPage, this.state.totalUserPages);
        this.renderUsersTable();
        this.renderUsersPagination();
    }

    initUserSearch() {
        document.getElementById('user-search')?.addEventListener('input', () => {
            this.state.currentUserPage = 1;
            this.applyUserFilter();
        });
    }

    renderUsersTable() {
        const tbody = document.getElementById('users-table-body');
        const data = this.state.filteredUsers || this.state.users;
        const start = (this.state.currentUserPage - 1) * ITEMS_PER_PAGE;
        const pageUsers = data.slice(start, start + ITEMS_PER_PAGE);

        tbody.innerHTML = pageUsers.length === 0
            ? '<tr><td colspan="4" class="text-center">Пользователи не найдены</td></tr>'
            : pageUsers.map(user => `
                <tr class="player-row${String(user.id) === String(this.state.selectedUserId) ? ' selected' : ''}" data-id="${escapeAttr(user.id)}" tabindex="0" aria-label="Открыть игрока ${escapeAttr(user.username)}">
                    <td>${escapeHtml(user.id)}</td>
                    <td class="player-name">${escapeHtml(user.username)}</td>
                    <td>${escapeHtml(this.utils.formatDate(user.created_at))}</td>
                    <td class="row-actions">
                        <button class="btn btn-small rename-user-btn" data-id="${escapeAttr(user.id)}" data-username="${escapeAttr(user.username)}">Имя</button>
                        <button class="btn btn-small change-password-btn" data-id="${escapeAttr(user.id)}" data-username="${escapeAttr(user.username)}">Пароль</button>
                        <button class="btn btn-small clear-progress-btn" data-id="${escapeAttr(user.id)}" data-username="${escapeAttr(user.username)}">Сброс</button>
                        <button class="btn btn-small btn-danger delete-user-btn" data-id="${escapeAttr(user.id)}" data-username="${escapeAttr(user.username)}">Удалить</button>
                    </td>
                </tr>`).join('');

        tbody.querySelectorAll('.rename-user-btn').forEach(btn =>
            btn.addEventListener('click', () => this.openRenameModal(btn.dataset.id, btn.dataset.username)));
        tbody.querySelectorAll('.change-password-btn').forEach(btn =>
            btn.addEventListener('click', () => this.openPasswordModal(btn.dataset.id, btn.dataset.username)));
        tbody.querySelectorAll('.delete-user-btn').forEach(btn =>
            btn.addEventListener('click', () => this.openDeleteUserModal(btn.dataset.id, btn.dataset.username)));
        tbody.querySelectorAll('.clear-progress-btn').forEach(btn =>
            btn.addEventListener('click', () => this.openClearProgressModal(btn.dataset.id, btn.dataset.username)));

        tbody.querySelectorAll('.player-row').forEach(row => {
            const open = e => {
                if (e.target.closest('button')) return;
                this.selectPlayer(parseInt(row.dataset.id));
            };
            row.addEventListener('click', open);
            row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(e); } });
        });
    }

    renderUsersPagination() {
        const container = document.getElementById('users-pagination');
        container.textContent = '';
        if (this.state.totalUserPages <= 1) return;

        const go = page => {
            this.state.currentUserPage = page;
            this.renderUsersTable();
            this.renderUsersPagination();
        };
        const button = (text, disabled, onClick, active = false) => {
            const btn = document.createElement('button');
            btn.className = `pagination-button${disabled ? ' disabled' : ''}${active ? ' active' : ''}`;
            btn.textContent = text;
            if (!disabled) btn.addEventListener('click', onClick);
            return btn;
        };
        const { currentUserPage: page, totalUserPages: total } = this.state;
        container.appendChild(button('«', page === 1, () => go(page - 1)));
        let start = Math.max(1, page - 2);
        const end = Math.min(total, start + 4);
        start = Math.max(1, end - 4);
        for (let i = start; i <= end; i++) container.appendChild(button(String(i), false, () => go(i), i === page));
        container.appendChild(button('»', page === total, () => go(page + 1)));
    }

    async selectPlayer(userId) {
        this.state.selectedUserId = userId;
        document.querySelectorAll('#users-table-body .player-row').forEach(row =>
            row.classList.toggle('selected', parseInt(row.dataset.id) === userId));

        const user = this.state.users.find(u => u.id === userId);
        document.getElementById('player-detail-title').textContent = user ? `Игрок: ${user.username}` : 'Игрок';
        document.getElementById('player-placeholder').hidden = true;
        document.getElementById('player-placeholder').style.display = 'none';
        document.getElementById('player-content').hidden = false;

        const loading = document.getElementById('relations-loading');
        if (!this.relationsData) {
            loading.style.display = 'flex';
            try {
                this.relationsData = await api.relations.all();
            } catch (error) {
                console.error('Relations error:', error);
                this.relationsData = { relations: [], users: [] };
                toast(`Отношения не загрузились: ${error.message}`, 'error');
            }
            loading.style.display = 'none';
        }
        this.renderRelationsForUser(userId);
        this.renderPlayerProgress();
        this.loadPlayerPilots(userId);
    }

    // ===================== переименование =====================

    openRenameModal(userId, username) {
        document.getElementById('rename-user-id').value = userId;
        const input = document.getElementById('rename-username');
        input.value = username;
        document.getElementById('rename-error').style.display = 'none';
        document.getElementById('rename-user-modal').style.display = 'flex';
        input.focus();
        input.select();
    }

    async renameUser() {
        const userId = document.getElementById('rename-user-id').value;
        const username = document.getElementById('rename-username').value.trim();
        const errorEl = document.getElementById('rename-error');
        const fail = message => { errorEl.textContent = message; errorEl.style.display = 'block'; };
        if (!/^[a-zA-Z0-9_]{3,50}$/.test(username)) return fail('Только латинские буквы, цифры и _, от 3 до 50 символов');
        try {
            const data = await api.renameUser(Number(userId), username);
            document.getElementById('rename-user-modal').style.display = 'none';
            const user = this.state.users.find(u => String(u.id) === String(userId));
            if (user) user.username = data.username;
            this.applyUserFilter();
            if (String(this.state.selectedUserId) === String(userId)) {
                document.getElementById('player-detail-title').textContent = `Игрок: ${data.username}`;
            }
            toast(`Логин изменён: ${data.username}`, 'success');
        } catch (error) {
            fail(error.message);
        }
    }

    // ===================== пилоты игрока =====================

    async loadPlayerPilots(userId) {
        const host = document.getElementById('player-pilots');
        host.innerHTML = '<div class="form-help">Загрузка пилотов...</div>';
        try {
            const pilots = (await api.pilots.list(userId)).pilots || [];
            if (this.state.selectedUserId !== userId) return;
            this.playerPilots = pilots;
            this.renderPlayerPilots();
        } catch (error) {
            host.innerHTML = `<div class="form-help text-danger">Пилоты не загрузились: ${escapeHtml(error.message)}</div>`;
        }
    }

    pilotHouse(p) {
        return p.estate === 'cavalier' && window.KtbHouses ? window.KtbHouses.resolveHouse(p) : null;
    }

    renderPlayerPilots() {
        const host = document.getElementById('player-pilots');
        const pilots = this.playerPilots || [];
        if (!pilots.length) {
            host.innerHTML = '<div class="no-data">У игрока нет пилотов.</div>';
            return;
        }
        const THEMES = { yellow: 'IPS-N', green: 'GMS', ktb: 'КТБ', horus: 'HORUS', ssc: 'SSC', ha: 'HA' };
        const GENDERS = { female: 'леди', male: 'лорд', neutral: 'нейтр.' };
        host.textContent = '';
        pilots.forEach(p => {
            const house = this.pilotHouse(p);
            const card = document.createElement('div');
            card.className = `pilot-card${p.is_active ? ' is-active' : ''}`;
            const estate = p.estate === 'cavalier'
                ? `Кавалер${p.house_standing === 'exile' ? ' · изгнанник' : ''}${house ? ` · ${house.name}` : ''}`
                : 'Лансер';
            card.innerHTML = `
                <div class="pilot-card-head">
                    <span class="pilot-slot">Слот ${escapeHtml(p.slot_number)}</span>
                    <b class="pilot-callsign"></b>
                    ${p.is_active ? '<span class="pilot-active-mark">● активен</span>' : ''}
                </div>
                <div class="pilot-card-meta"></div>
                <div class="pilot-card-tags">
                    <span class="info-chip"></span>
                    <span class="info-chip">${escapeHtml(GENDERS[p.gender] || p.gender)}</span>
                    <span class="info-chip">тема ${escapeHtml(THEMES[p.theme] || p.theme || '—')}</span>
                </div>
                <div class="pilot-card-actions">
                    <button class="btn btn-small pilot-edit-btn">Изменить</button>
                    ${p.is_active ? '' : '<button class="btn btn-small pilot-activate-btn">Сделать активным</button>'}
                </div>`;
            card.querySelector('.pilot-callsign').textContent = p.callsign;
            card.querySelector('.pilot-card-meta').textContent = `${p.full_name || '—'} · мех ${p.mech_name || '—'}`;
            card.querySelector('.pilot-card-tags .info-chip').textContent = estate;
            card.querySelector('.pilot-edit-btn').addEventListener('click', () => this.openPilotModal(p));
            card.querySelector('.pilot-activate-btn')?.addEventListener('click', async () => {
                try {
                    await api.pilots.activate(this.state.selectedUserId, p.slot_number);
                    toast(`Активный пилот: ${p.callsign}`, 'success');
                    this.loadPlayerPilots(this.state.selectedUserId);
                } catch (error) {
                    toast(error.message, 'error');
                }
            });
            host.appendChild(card);
        });
    }

    initPilotForm() {
        const houses = window.KtbHouses;
        const houseSelect = document.getElementById('pilot-house');
        houseSelect.innerHTML = '<option value="">— без Дома —</option>' +
            (houses ? houses.HOUSES.map(h => `<option value="${escapeAttr(h.id)}">${escapeHtml(h.name)}</option>`).join('') : '') +
            '<option value="custom">Свой Дом…</option>';
        document.getElementById('pilot-house-sigil').innerHTML = houses
            ? houses.CUSTOM_SIGIL_GROUPS.map(g => `<optgroup label="${escapeAttr(g.title)}">${g.sigils
                .map(id => `<option value="${escapeAttr(id)}">${escapeHtml(houses.SIGIL_LABELS[id] || id)}</option>`).join('')}</optgroup>`).join('')
            : '<option value="crown">Корона</option>';
        const sync = () => this.syncPilotForm();
        document.getElementById('pilot-estate').addEventListener('change', sync);
        houseSelect.addEventListener('change', sync);
    }

    syncPilotForm() {
        const cavalier = document.getElementById('pilot-estate').value === 'cavalier';
        document.getElementById('pilot-cavalier').hidden = !cavalier;
        const custom = document.getElementById('pilot-house').value === 'custom';
        document.querySelectorAll('#pilot-modal .pilot-custom-house').forEach(el => { el.hidden = !custom; });
    }

    openPilotModal(p) {
        const set = (id, value) => { document.getElementById(id).value = value ?? ''; };
        set('pilot-user-id', this.state.selectedUserId);
        set('pilot-slot', p.slot_number);
        set('pilot-callsign', p.callsign);
        set('pilot-mech', p.mech_name);
        set('pilot-full-name', p.full_name);
        set('pilot-estate', p.estate === 'cavalier' ? 'cavalier' : 'lancer');
        set('pilot-gender', ['female', 'male'].includes(p.gender) ? p.gender : 'neutral');
        set('pilot-theme', ['yellow', 'green', 'ktb', 'horus', 'ssc', 'ha'].includes(p.theme) ? p.theme : 'yellow');
        set('pilot-house', p.house_key || '');
        set('pilot-standing', p.house_standing === 'exile' ? 'exile' : 'member');
        set('pilot-house-custom', p.house_custom);
        set('pilot-house-color', /^#[0-9a-f]{6}$/i.test(p.house_color || '') ? p.house_color : '#b8a27a');
        // Старый свой Дом мог взять знак Великого Дома — добавляем его в список, чтобы не потерять.
        const sigilSelect = document.getElementById('pilot-house-sigil');
        if (p.house_sigil && ![...sigilSelect.options].some(o => o.value === p.house_sigil)) {
            sigilSelect.add(new Option(`${window.KtbHouses?.SIGIL_LABELS?.[p.house_sigil] || p.house_sigil} (текущий)`, p.house_sigil), 0);
        }
        set('pilot-house-sigil', p.house_sigil || 'crown');
        document.getElementById('pilot-modal-title').textContent = `Пилот: ${p.callsign} (слот ${p.slot_number})`;
        document.getElementById('pilot-error').style.display = 'none';
        this.syncPilotForm();
        document.getElementById('pilot-modal').style.display = 'flex';
        document.getElementById('pilot-callsign').focus();
    }

    async savePilot() {
        const value = id => document.getElementById(id).value;
        const errorEl = document.getElementById('pilot-error');
        const houseKey = value('pilot-house');
        const body = {
            callsign: value('pilot-callsign').trim(),
            mech_name: value('pilot-mech').trim(),
            full_name: value('pilot-full-name').trim(),
            estate: value('pilot-estate'),
            gender: value('pilot-gender'),
            theme: value('pilot-theme'),
            house_key: houseKey,
            house_standing: value('pilot-standing'),
            house_custom: houseKey === 'custom' ? value('pilot-house-custom').trim() : '',
            house_color: houseKey === 'custom' ? value('pilot-house-color') : '',
            house_sigil: houseKey === 'custom' ? value('pilot-house-sigil') : ''
        };
        try {
            await api.pilots.update(value('pilot-user-id'), value('pilot-slot'), body);
            document.getElementById('pilot-modal').style.display = 'none';
            toast('Пилот сохранён', 'success');
            this.loadPlayerPilots(this.state.selectedUserId);
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
        }
    }

    renderPlayerProgress() {
        const tbody = document.getElementById('player-progress-body');
        const user = this.state.users.find(u => u.id === this.state.selectedUserId);
        if (!tbody || !user) return;
        const rows = this.state.progressData.filter(p => p.username === user.username)
            .sort((a, b) => a.frequency.localeCompare(b.frequency));
        tbody.innerHTML = rows.length === 0
            ? '<tr><td colspan="3" class="text-center">Игрок ещё не проходил диалоги</td></tr>'
            : rows.map(p => `
                <tr>
                    <td>${escapeHtml(p.frequency)}</td>
                    <td>${escapeHtml(p.repeat_count || 0)} / ${escapeHtml(p.max_repeats || 1)}</td>
                    <td><span class="status-badge ${this.statusClass(p.status)}">${escapeHtml(p.status)}</span></td>
                </tr>`).join('');
    }

    openPasswordModal(userId, username) {
        document.getElementById('user-id-input').value = userId;
        document.getElementById('modal-username').textContent = username;
        document.getElementById('new-password').value = '';
        document.getElementById('confirm-password').value = '';
        document.getElementById('password-error').style.display = 'none';
        document.getElementById('password-modal').style.display = 'flex';
        document.getElementById('new-password').focus();
    }

    async changePassword() {
        const userId = document.getElementById('user-id-input').value;
        const newPassword = document.getElementById('new-password').value;
        const confirmPassword = document.getElementById('confirm-password').value;
        const errorEl = document.getElementById('password-error');
        const fail = message => { errorEl.textContent = message; errorEl.style.display = 'block'; };

        if (newPassword.length < 6) return fail('Пароль должен содержать минимум 6 символов');
        if (newPassword !== confirmPassword) return fail('Пароли не совпадают');

        try {
            await api.changePassword(userId, newPassword);
            document.getElementById('password-modal').style.display = 'none';
            toast('Пароль изменён', 'success');
        } catch (error) {
            fail(error.message);
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
            await api.deleteUser(userId);
            document.getElementById('delete-user-modal').style.display = 'none';
            toast('Пользователь удалён', 'success');
            if (String(this.state.selectedUserId) === String(userId)) this.resetPlayerDetail();
            this.relationsData = null;
            await this.loadUsersData();
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
        }
    }

    resetPlayerDetail() {
        this.state.selectedUserId = null;
        document.getElementById('player-detail-title').textContent = 'Игрок';
        document.getElementById('player-placeholder').hidden = false;
        document.getElementById('player-placeholder').style.display = '';
        document.getElementById('player-content').hidden = true;
    }

    async openClearProgressModal(userId, username) {
        document.getElementById('clear-progress-user-id').value = userId;
        document.getElementById('clear-progress-username').textContent = username;
        document.getElementById('clear-progress-error').style.display = 'none';

        const select = document.getElementById('clear-frequency');
        select.innerHTML = '<option value="">Загрузка...</option>';
        document.getElementById('clear-progress-modal').style.display = 'flex';

        try {
            const data = await api.getFrequencies();
            select.innerHTML = data?.frequencies?.length
                ? '<option value="all">Очистить все</option>' + data.frequencies.map(f =>
                    `<option value="${escapeAttr(f.frequency)}">${escapeHtml(f.frequency)}${f.title ? ' - ' + escapeHtml(f.title) : ''}</option>`).join('')
                : '<option value="">Нет диалогов</option>';
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
            await api.clearProgress(userId, frequency);
            document.getElementById('clear-progress-modal').style.display = 'none';
            toast('Прохождение очищено', 'success');
            await this.loadProgressData();
        } catch (error) {
            errorEl.textContent = error.message;
            errorEl.style.display = 'block';
        }
    }

    // Несохранённое значение — пунктирная рамка в цвете темы (admin-themes.css, .is-dirty).
    markRelDirty(input) { input.classList.add('is-dirty'); }
    markRelClean(input) { input.classList.remove('is-dirty'); }

    // Отношения игрока с персонажами: строка на персонажа, клик раскрывает пилотов.
    renderRelationsForUser(userId) {
        const data = this.relationsData || { relations: [] };
        const tbody = document.getElementById('relations-table-body');
        if (!tbody) return;

        // Стартовое значение — строка пилота 0; если её нет, берём любую строку персонажа.
        const byChar = {};
        data.relations.filter(r => r.user_id === userId).forEach(r => {
            if (!byChar[r.global_character_id] || r.pilot_profile_id === 0) byChar[r.global_character_id] = r;
        });
        const rows = Object.values(byChar);

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center">У игрока пока нет записей об отношениях: они появятся после первого выбора или если задать значение в студии, раздел «Персонажи».</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(r => {
            const val = r.relation_value;
            const color = relationColor(val);
            const barPercent = ((val + 100) / 200) * 100;
            const barStyle = val >= 0
                ? `left:50%;width:${barPercent - 50}%;background-color:${color};`
                : `left:${barPercent}%;width:${50 - barPercent}%;background-color:${color};`;
            return `<tr class="rel-char-row" data-user-id="${escapeAttr(userId)}" data-gc-id="${escapeAttr(r.global_character_id)}">
                <td>
                    <button type="button" class="rel-toggle" aria-expanded="false" aria-label="Пилоты">▸</button>
                    ${escapeHtml(r.character_name)}
                </td>
                <td>
                    <div class="rel-value-row">
                        <input type="number" class="form-input rel-edit-input" value="${val}" min="-100" max="100" step="5" style="--rel-color:${color};" aria-label="Отношение">
                        <div class="rel-bar"><div style="${barStyle}"></div></div>
                        <span class="rel-sign" style="color:${color};">${formatRelation(val)}</span>
                    </div>
                    <div class="form-help">Применяется ко всем пилотам аккаунта</div>
                </td>
                <td><button class="btn btn-small rel-save-btn">Сохранить</button></td>
            </tr>
            <tr class="rel-pilots-row" data-user-id="${escapeAttr(userId)}" style="display:none;">
                <td colspan="3" class="rel-pilots-cell"></td>
            </tr>`;
        }).join('');

        tbody.querySelectorAll('.rel-save-btn').forEach(btn => {
            btn.addEventListener('click', async e => {
                e.stopPropagation();
                const row = btn.closest('tr');
                const input = row.querySelector('.rel-edit-input');
                const val = Math.max(-100, Math.min(100, parseInt(input.value) || 0));
                input.value = val;
                try {
                    await api.relations.set(row.dataset.gcId, row.dataset.userId, { relationValue: val, global: true });
                    this.markRelClean(input);
                    this.updateCachedRelation(parseInt(row.dataset.userId), row.dataset.gcId, 0, val);
                    toast('Отношение сохранено', 'success');
                } catch (err) {
                    toast(`Ошибка сохранения: ${err.message}`, 'error');
                }
            });
        });

        tbody.querySelectorAll('.rel-edit-input').forEach(input => {
            input.addEventListener('input', () => {
                input.style.setProperty('--rel-color', relationColor(parseInt(input.value) || 0));
                this.markRelDirty(input);
            });
        });

        tbody.querySelectorAll('.rel-char-row').forEach(row => {
            row.addEventListener('click', e => {
                if (e.target.closest('input, label') || (e.target.closest('button') && !e.target.closest('.rel-toggle'))) return;
                this.toggleAdminRelationsPilots(row);
            });
        });
    }

    updateCachedRelation(userId, gcId, pilotId, value) {
        const list = this.relationsData?.relations;
        if (!list) return;
        const hit = list.find(r => r.user_id === userId && String(r.global_character_id) === String(gcId) && r.pilot_profile_id === pilotId);
        if (hit) hit.relation_value = value;
    }

    async toggleAdminRelationsPilots(charRow) {
        const userId = parseInt(charRow.dataset.userId);
        const gcId = charRow.dataset.gcId;
        const pilotsRow = charRow.nextElementSibling;
        if (!pilotsRow?.classList.contains('rel-pilots-row')) return;
        const cell = pilotsRow.querySelector('.rel-pilots-cell');
        const toggle = charRow.querySelector('.rel-toggle');
        const setOpen = open => {
            pilotsRow.style.display = open ? 'table-row' : 'none';
            if (toggle) { toggle.textContent = open ? '▾' : '▸'; toggle.setAttribute('aria-expanded', String(open)); }
        };

        if (pilotsRow.style.display !== 'none') return setOpen(false);
        setOpen(true);
        if (cell.dataset.loaded === '1') return;

        cell.innerHTML = '<span class="form-help">Загрузка пилотов...</span>';
        try {
            const pilots = (await api.getUserPilots(userId)).pilots || [];
            const rels = (this.relationsData?.relations || []).filter(r =>
                r.user_id === userId && String(r.global_character_id) === String(gcId));

            if (pilots.length === 0) {
                cell.innerHTML = '<span class="form-help">У игрока нет пилотов.</span>';
                cell.dataset.loaded = '1';
                return;
            }

            const baseVal = parseInt(charRow.querySelector('.rel-edit-input')?.value) || 0;
            cell.innerHTML = pilots.map(p => {
                const rel = rels.find(r => r.pilot_profile_id === p.id);
                const value = rel ? rel.relation_value : baseVal;
                const color = relationColor(value);
                const activeMark = p.is_active ? ' <span class="pilot-active-mark">● активен</span>' : '';
                return `
                    <div class="rel-pilot-item" data-user-id="${escapeAttr(userId)}" data-gc-id="${escapeAttr(gcId)}" data-pilot-id="${escapeAttr(p.id)}">
                        <span class="rel-pilot-name">${escapeHtml(p.callsign || ('Пилот ' + p.slot_number))}${activeMark}</span>
                        <input type="number" class="form-input rel-pilot-value-input" value="${escapeAttr(value)}" min="-100" max="100" step="5" style="--rel-color:${color};" aria-label="Отношение пилота">
                        <button class="btn btn-small rel-pilot-save-btn" aria-label="Сохранить">✓</button>
                    </div>`;
            }).join('');

            cell.querySelectorAll('.rel-pilot-value-input').forEach(input => {
                input.addEventListener('input', () => {
                    input.style.setProperty('--rel-color', relationColor(parseInt(input.value) || 0));
                    this.markRelDirty(input);
                });
            });
            cell.querySelectorAll('.rel-pilot-save-btn').forEach(btn => {
                btn.addEventListener('click', async () => {
                    const item = btn.closest('.rel-pilot-item');
                    const input = item.querySelector('.rel-pilot-value-input');
                    const val = Math.max(-100, Math.min(100, parseInt(input.value) || 0));
                    input.value = val;
                    try {
                        await api.relations.set(item.dataset.gcId, item.dataset.userId, { relationValue: val, pilotProfileId: parseInt(item.dataset.pilotId) });
                        this.markRelClean(input);
                        toast('Отношение пилота сохранено', 'success');
                    } catch (err) {
                        toast(`Ошибка сохранения: ${err.message}`, 'error');
                    }
                });
            });
            cell.dataset.loaded = '1';
        } catch (err) {
            console.error('Error loading pilots:', err);
            cell.innerHTML = '<span class="form-help text-danger">Ошибка загрузки пилотов</span>';
        }
    }

    // ===================== МУЗЫКА =====================

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
        tbody.textContent = '';

        try {
            const data = await api.music.list();
            const tracks = (data?.tracks || []).filter(t => t.theme === this.musicTheme);
            this.musicTracks = tracks;
            if (empty) empty.style.display = tracks.length ? 'none' : 'block';
            this.renderMusicTable(tracks);
        } catch (error) {
            console.error('Music error:', error);
            tbody.innerHTML = '<tr><td colspan="4" class="text-center">Ошибка загрузки</td></tr>';
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
                    <input type="number" class="form-input music-vol-input" value="${Number(t.volume)}" min="0" max="100" step="5" aria-label="Громкость, %">
                    <span class="form-help">%</span>
                </td>
                <td><button class="btn btn-small music-preview-btn" aria-label="Прослушать">▶</button></td>
                <td><button class="btn btn-small btn-danger music-del-btn">Удалить</button></td>
            </tr>`).join('');

        // Громкость из поля сразу слышна в прослушке этого трека — и до сохранения, и после.
        const volumeOf = row => Math.max(0, Math.min(100, parseInt(row.querySelector('.music-vol-input').value) || 0)) / 100;
        tbody.querySelectorAll('.music-vol-input').forEach(input => {
            input.addEventListener('input', () => {
                const row = input.closest('tr');
                if (this.previewAudio && this.previewTrackId === row.dataset.trackId) this.previewAudio.volume = volumeOf(row);
            });
            input.addEventListener('change', async () => {
                const id = input.closest('tr').dataset.trackId;
                const vol = Math.max(0, Math.min(100, parseInt(input.value) || 0));
                input.value = vol;
                try {
                    await api.music.update(id, { volume: vol });
                    const track = (this.musicTracks || []).find(t => String(t.id) === String(id));
                    if (track) track.volume = vol;
                    toast('Громкость сохранена', 'success');
                } catch (e) {
                    toast(`Ошибка сохранения громкости: ${e.message}`, 'error');
                }
            });
        });

        if (!this.previewAudio) {
            this.previewAudio = new Audio();
            this.previewAudio.addEventListener('ended', () => {
                document.querySelectorAll('.music-preview-btn').forEach(b => { b.textContent = '▶'; });
            });
        }
        tbody.querySelectorAll('.music-preview-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.closest('tr').dataset.trackId;
                const track = (this.musicTracks || []).find(t => String(t.id) === String(id));
                if (!track) return;
                const url = /^https?:/.test(track.file_path) ? track.file_path : this.musicServerOrigin + track.file_path;
                const resetIcons = () => tbody.querySelectorAll('.music-preview-btn').forEach(b => { b.textContent = '▶'; });

                if (this.previewAudio.src === url && !this.previewAudio.paused) {
                    this.previewAudio.pause();
                    this.previewAudio.currentTime = 0;
                    this.previewTrackId = null;
                    resetIcons();
                    return;
                }
                this.previewAudio.pause();
                this.previewAudio.src = url;
                this.previewTrackId = String(id);
                this.previewAudio.volume = volumeOf(btn.closest('tr'));
                this.previewAudio.play().catch(e => toast(`Не удалось воспроизвести: ${e.message}`, 'error'));
                resetIcons();
                btn.textContent = '⏹';
            });
        });

        tbody.querySelectorAll('.music-del-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                const row = btn.closest('tr');
                if (row.dataset.confirm !== '1') {
                    row.dataset.confirm = '1';
                    btn.textContent = 'Точно удалить?';
                    setTimeout(() => { row.dataset.confirm = ''; btn.textContent = 'Удалить'; }, 3000);
                    return;
                }
                try {
                    await api.music.remove(row.dataset.trackId);
                    toast('Трек удалён', 'success');
                    this.loadMusicData();
                } catch (e) {
                    toast(`Ошибка удаления: ${e.message}`, 'error');
                }
            });
        });
    }

    initMusicTab() {
        const fileInput = document.getElementById('music-file-input');
        const status = document.getElementById('music-upload-status');

        document.getElementById('music-theme-select')?.addEventListener('change', () => this.loadMusicData());
        document.getElementById('music-upload-btn')?.addEventListener('click', () => fileInput?.click());

        fileInput?.addEventListener('change', async () => {
            const file = fileInput.files[0];
            if (!file) return;
            if (status) status.textContent = 'Загрузка...';
            try {
                const form = new FormData();
                form.append('music', file);
                form.append('theme', this.musicTheme);
                form.append('title', file.name.replace(/\.[^.]+$/, ''));
                await api.music.upload(form);
                if (status) status.textContent = 'Трек загружен.';
                fileInput.value = '';
                this.loadMusicData();
            } catch (e) {
                if (status) status.textContent = `Ошибка: ${e.message}`;
            }
            setTimeout(() => { if (status) status.textContent = ''; }, 5000);
        });
    }
}

new AdminApp().init();
