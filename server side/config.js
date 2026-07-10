require('dotenv').config();

// Значения, которые считаются «не заданными» / небезопасными дефолтами.
const PLACEHOLDER_SESSION_SECRET = 'REPLACEMESECRETKEY';
const PLACEHOLDER_SETUP_KEY = 'REPLACEMESETUPKEY';
const PLACEHOLDER_ORIGIN = 'https://REPLACEME';
const PLACEHOLDER_PATTERNS = [/REPLACEME/i, /DOMENHERE/i, /your-domain/i];

const ALLOWED_DEBUG_TRUTHY = ['true', '1', 'yes', 'on'];

function isPlaceholder(value, exactPlaceholders = []) {
    if (!value) return true;
    if (exactPlaceholders.includes(value)) return true;
    return PLACEHOLDER_PATTERNS.some(re => re.test(value));
}

const rawAllowHttp = (process.env.ALLOW_HTTP || '0').trim().toLowerCase();
const rawDebug = (process.env.DEBUG || 'false').trim().toLowerCase();

const config = {
    PORT: parseInt(process.env.PORT, 10) || 3000,
    SESSION_SECRET: process.env.SESSION_SECRET || PLACEHOLDER_SESSION_SECRET,
    CORS_ORIGINS: (process.env.CORS_ORIGINS || PLACEHOLDER_ORIGIN)
        .split(',').map(s => s.trim()).filter(Boolean),
    SESSION_MAX_AGE: parseInt(process.env.SESSION_MAX_AGE, 10) || (24 * 60 * 60 * 1000),
    SSL_KEY_PATH: process.env.SSL_KEY_PATH || 'ssl/privkey.pem',
    SSL_CERT_PATH: process.env.SSL_CERT_PATH || 'ssl/cert.pem',
    SETUP_KEY: process.env.SETUP_KEY || PLACEHOLDER_SETUP_KEY,
    DB_PATH: process.env.DB_PATH || './database.db',
    // DEBUG = true включает подробные логи (info/debug). По умолчанию выключено.
    DEBUG: ALLOWED_DEBUG_TRUTHY.includes(rawDebug),
    // ALLOW_HTTP = 1 разрешает запуск без SSL (только для локальной разработки).
    ALLOW_HTTP: rawAllowHttp === '1' || rawAllowHttp === 'true',

    validate() {
        const errors = [];

        if (isPlaceholder(this.SESSION_SECRET, [PLACEHOLDER_SESSION_SECRET]) || this.SESSION_SECRET.length < 32) {
            errors.push(
                'SESSION_SECRET не задан, является плейсхолдером или короче 32 символов. ' +
                'Сгенерируйте сильный ключ: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64\'))"'
            );
        }

        if (isPlaceholder(this.SETUP_KEY, [PLACEHOLDER_SETUP_KEY]) || this.SETUP_KEY.length < 16) {
            errors.push(
                'SETUP_KEY не задан, является плейсхолдером или короче 16 символов. ' +
                'Сгенерируйте сильный ключ: node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'base64\'))"'
            );
        }

        if (this.CORS_ORIGINS.length === 0 || this.CORS_ORIGINS.some(o => isPlaceholder(o))) {
            errors.push(
                'CORS_ORIGINS не задан или содержит плейсхолдеры. Укажите реальные домены, например: https://example.com,https://www.example.com'
            );
        }

        if (errors.length > 0) {
            console.error('\n========================================');
            console.error(' КРИТИЧЕСКАЯ ОШИБКА КОНФИГУРАЦИИ');
            console.error('========================================');
            errors.forEach(e => console.error(' - ' + e));
            console.error('\nСервер не запущен в целях безопасности. Заполните server side/.env (см. .env.example).');
            console.error('========================================\n');
            process.exit(1);
        }

        if (this.ALLOW_HTTP) {
            console.warn('ВНИМАНИЕ: ALLOW_HTTP=1 — сервер запустится без SSL. Используйте ТОЛЬКО для локальной разработки.');
        }
    }
};

module.exports = config;
