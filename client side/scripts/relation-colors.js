// Смысловые цвета репутации — одинаковые во всех темах (GMS / IPS-N / КТБ):
// плюс — зелёный, минус — красный, ноль (не изменено) — жёлтый.
// Сами цвета заданы в styles/admin-themes.css (--rel-positive / --rel-negative / --rel-neutral).

export function relationColor(value) {
    const v = Number(value) || 0;
    if (v > 0) return 'var(--rel-positive)';
    if (v < 0) return 'var(--rel-negative)';
    return 'var(--rel-neutral)';
}

// Знак перед числом, чтобы значение читалось и без цвета: +20, −10, 0.
export function formatRelation(value) {
    const v = Number(value) || 0;
    if (v > 0) return `+${v}`;
    if (v < 0) return `−${Math.abs(v)}`;
    return '0';
}
