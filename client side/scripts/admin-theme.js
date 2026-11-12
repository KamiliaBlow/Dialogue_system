import AppConfig from './config.js';

const VALID_THEMES = ['yellow', 'green', 'ktb'];

// Применяет тему из профиля пользователя (user-settings.theme) к админ-страницам.
// Тема 'green' — базовая (класс не добавляется), поэтому переопределения заданы
// только для 'yellow' и 'ktb' в styles/admin-styles.css.
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
        if (theme !== 'green') {
            document.body.classList.add(`theme-${theme}`);
        }
    } catch (e) {
        console.log('Не удалось применить тему админки:', e);
    }
}
