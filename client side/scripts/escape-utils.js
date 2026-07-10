/**
 * Утилиты экранирования для безопасной вставки серверных данных в DOM.
 *
 * Защита от stored XSS: имя пользователя, текст реплик, choice_text,
 * имена персонажей и файлов приходят с сервера и вставляются через innerHTML.
 * Эти функции предотвращают разрыв HTML-узлов и атрибутов.
 */

// Экранирование для текстовых узлов HTML (защита от <script>, </td>, и т.п.).
export function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Экранирование для значений внутри HTML-атрибутов (src, alt, data-*, value, style).
// Дополнительно экранирует кавычки, чтобы предотвратить разрыв атрибута.
export function escapeAttr(value) {
    return escapeHtml(value);
}

// Ограничение значения числом для безопасной подстановки в CSS/атрибуты.
// Если не число — возвращает fallback.
export function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export default { escapeHtml, escapeAttr, safeNumber };
