// Общие помощники роутов редактора: пути к медиа и проверка загружаемых файлов.
const path = require('path');
const fs = require('fs');

// routes/editor → server side/assets
const ASSETS_DIR = path.join(__dirname, '..', '..', 'assets');
const PORTRAITS_DIR = path.join(ASSETS_DIR, 'images', 'portraits');

// Защита от path traversal: проверяет, что результирующий путь остаётся внутри baseDir.
function isPathSafe(relativePath, baseDir) {
    if (!relativePath || typeof relativePath !== 'string') return false;
    const cleaned = relativePath.replace(/^\/+/, '').replace(/\.\./g, '').trim();
    if (!cleaned) return false;
    const full = path.resolve(baseDir, cleaned);
    const base = path.resolve(baseDir);
    return full === base || full.startsWith(base + path.sep);
}

// Нормализует путь медиафайла, сохранённый как /assets/... к безопасному виду.
// Возвращает null, если путь выходит за пределы assets.
function sanitizeAssetPath(input) {
    if (!input || typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (!trimmed) return null;
    // Должен начинаться с /assets/...
    const rel = trimmed.startsWith('/assets/') ? trimmed.slice('/assets/'.length) : trimmed;
    if (!isPathSafe(rel, ASSETS_DIR)) return null;
    return '/assets/' + rel.replace(/\\/g, '/');
}

// Проверка сигнатур (magic bytes) загруженного изображения.
function validateImageMagicBytes(file) {
    if (!file || !file.path) return false;
    try {
        const fd = fs.openSync(file.path, 'r');
        const buf = Buffer.alloc(16);
        const bytes = fs.readSync(fd, buf, 0, 16, 0);
        fs.closeSync(fd);
        const b = buf.slice(0, bytes);
        if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return true;       // JPEG
        if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return true; // PNG
        if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true; // GIF
        if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
            && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return true; // WEBP
        return false;
    } catch {
        return false;
    }
}

// Проверка сигнатур для аудиофайлов.
function validateAudioMagicBytes(file) {
    if (!file || !file.path) return false;
    try {
        const fd = fs.openSync(file.path, 'r');
        const buf = Buffer.alloc(16);
        const bytes = fs.readSync(fd, buf, 0, 16, 0);
        fs.closeSync(fd);
        const b = buf.slice(0, bytes);
        if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return true;        // MP3 (ID3)
        if (b[0] === 0xFF && (b[1] === 0xFB || b[1] === 0xF3 || b[1] === 0xF2)) return true; // MP3
        if (b[0] === 0x4F && b[1] === 0x67 && b[2] === 0x47 && b[3] === 0x53) return true; // OGG
        if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
            && b[8] === 0x57 && b[9] === 0x41 && b[10] === 0x56 && b[11] === 0x45) return true; // WAV
        return false;
    } catch {
        return false;
    }
}

module.exports = {
    ASSETS_DIR,
    PORTRAITS_DIR,
    isPathSafe,
    sanitizeAssetPath,
    validateImageMagicBytes,
    validateAudioMagicBytes
};
