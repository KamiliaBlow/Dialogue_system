// Общий каркас админки: шапка с именем системы, навигация «Панель / Студия / Терминал»,
// проверка прав, тема активного пилота, фон и выход. Используют admin.html и studio.html.
import api from './admin-api.js';
import AdminUtils from './admin-utils.js';
import { applyAdminTheme } from '../admin-theme.js';

const PAGES = [
    { id: 'panel', href: 'admin.html', label: 'Панель' },
    { id: 'studio', href: 'studio.html', label: 'Студия' },
    { id: 'terminal', href: 'index.html', label: 'Терминал' }
];

function renderHeader(header, page, title) {
    header.classList.add('admin-header');
    header.textContent = '';

    // Имя системы (GMS-4521 / IPS-N-7.4.2 / ORACULUM-5.5.0) подставляет admin-theme.js.
    const titleEl = document.createElement('div');
    titleEl.className = 'admin-title';
    titleEl.textContent = `ТЕРМИНАЛ GMS-4521 · ${title}`;

    const nav = document.createElement('nav');
    nav.className = 'admin-nav';
    nav.setAttribute('aria-label', 'Разделы админки');
    PAGES.forEach(p => {
        const link = document.createElement('a');
        link.className = `admin-tab${p.id === page ? ' active' : ''}`;
        link.href = p.href;
        link.textContent = p.label;
        if (p.id === page) link.setAttribute('aria-current', 'page');
        nav.appendChild(link);
    });

    const logout = document.createElement('button');
    logout.type = 'button';
    logout.className = 'admin-logout';
    logout.textContent = 'ВЫХОД';
    logout.addEventListener('click', async () => {
        try { await api.logout(); } catch (e) { /* сессия уже могла закончиться */ }
        window.location.href = 'login.html';
    });

    header.append(titleEl, nav, logout);
}

export function showFatal(message, { retry = true } = {}) {
    const container = document.querySelector('.container');
    if (!container) return;
    const card = document.createElement('div');
    card.className = 'admin-card';
    const heading = document.createElement('div');
    heading.className = 'admin-card-title';
    heading.textContent = 'Ошибка';
    const text = document.createElement('p');
    text.textContent = message;
    card.append(heading, text);
    if (retry) {
        const again = document.createElement('button');
        again.className = 'btn';
        again.textContent = 'Повторить';
        again.addEventListener('click', () => location.reload());
        card.appendChild(again);
    }
    const home = document.createElement('a');
    home.className = 'btn';
    home.href = 'index.html';
    home.textContent = 'В терминал';
    card.appendChild(home);
    container.textContent = '';
    container.appendChild(card);
}

// page: 'panel' | 'studio'. Возвращает данные проверки прав или null, если доступа нет.
export async function initShell({ page, title }) {
    const header = document.getElementById('admin-shell');
    if (header) renderHeader(header, page, title);
    document.title = `${title[0]}${title.slice(1).toLowerCase()} — Терминал GMS-4521`;

    let auth;
    try {
        auth = await api.checkAuth();
    } catch (error) {
        if (error.status === 401) { window.location.href = 'login.html'; return null; }
        showFatal('Ошибка подключения к серверу. Проверьте, что сервер запущен на порту 3000.');
        return null;
    }
    if (!auth?.isAdmin) {
        showFatal('У вас нет прав администратора.', { retry: false });
        setTimeout(() => { window.location.href = 'index.html'; }, 2000);
        return null;
    }

    applyAdminTheme();
    AdminUtils.generateBackgroundCode();
    return auth;
}

// Кнопка «занято» на время запроса: не даёт отправить форму дважды.
export async function withBusy(button, task) {
    if (!button) return task();
    const wasDisabled = button.disabled;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
        return await task();
    } finally {
        button.disabled = wasDisabled;
        button.removeAttribute('aria-busy');
    }
}

// Короткое сообщение в углу экрана вместо alert().
export function toast(message, type = 'info') {
    let host = document.getElementById('admin-toasts');
    if (!host) {
        host = document.createElement('div');
        host.id = 'admin-toasts';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
    }
    const item = document.createElement('div');
    item.className = `admin-toast admin-toast-${type}`;
    item.textContent = message;
    host.appendChild(item);
    setTimeout(() => item.classList.add('leaving'), 3200);
    setTimeout(() => item.remove(), 3700);
}
