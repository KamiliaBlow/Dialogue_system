import AppConfig from './config.js';

const VALID_THEMES = ['yellow', 'green', 'ktb'];

// Имя системы в заголовках админ-страниц совпадает с терминалом активной темы.
const SYSTEM_NAMES = {
    green: 'GMS-4521',
    yellow: 'IPS-N-7.4.2',
    ktb: 'ORACULUM-5.5.0'
};

function applySystemName(theme) {
    const name = SYSTEM_NAMES[theme] || SYSTEM_NAMES.green;
    document.title = document.title.replace(/(Терминал\s+)\S+/, `$1${name}`);
    document.querySelectorAll('.admin-title').forEach(title => {
        title.textContent = title.textContent.replace(/(ТЕРМИНАЛ\s+)\S+/, `$1${name}`);
    });
}

// Применяет тему из профиля пользователя (user-settings.theme) к админ-страницам.
// Токены и оформление тем — в styles/admin-styles.css и styles/admin-themes.css
// (green = GMS, yellow = IPS-N, ktb = КТБ).
export async function applyAdminTheme() {
    try {
        const response = await fetch(`${AppConfig.API_URL}/user-settings`, {
            credentials: 'include',
            headers: AppConfig.CACHE_HEADERS || {}
        });
        if (!response.ok) return;
        const data = await response.json();
        const theme = VALID_THEMES.includes(data?.theme) ? data.theme : 'green';
        try { localStorage.setItem('userTheme', theme); } catch (e) {}
        document.body.classList.remove('theme-yellow', 'theme-green', 'theme-ktb');
        document.body.classList.add(`theme-${theme}`);
        applySystemName(theme);
    } catch (e) {
        console.log('Не удалось применить тему админки:', e);
    }
}

// Сразу по кэшу темы, чтобы заголовок не мигал старым именем до ответа сервера.
try {
    const cached = localStorage.getItem('userTheme');
    if (VALID_THEMES.includes(cached)) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => applySystemName(cached), { once: true });
        } else {
            applySystemName(cached);
        }
    }
} catch (e) { /* хранилище недоступно */ }
