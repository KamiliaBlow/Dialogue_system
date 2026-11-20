// Брифинги миссий (3D-брифинг из client side/briefing).
//
// Сценарий хранится JSON-документом в колонке briefings.scenario: он читается и пишется только
// целиком, а структура (рельеф, объекты, шаги, камеры, планета, звук) часто меняется — старые
// сценарии дополняет normalize() на клиенте. В колонках рядом — то, по чему нужен отбор:
// доступ, активность, порядок, версия. Файлы (озвучка, звуки, музыка) лежат в
// assets/sounds/briefing, в сценарии только пути к ним.
//
//  playerRoutes  → /api/briefings (requireAuth): список доступных, сценарий, отметка «прослушан»;
//  editorRoutes  → /api/editor   (requireAdmin): всё для студии и редактора.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Logger = require('../utils/logger');
const { portraitForClient } = require('../utils/portrait');
const { ASSETS_DIR, validateAudioMagicBytes } = require('./editor/shared');

const AUDIO_DIR = path.join(ASSETS_DIR, 'sounds', 'briefing');
const AUDIO_PREFIX = '/assets/sounds/briefing/';
const PORTRAIT_PREFIX = '/assets/images/portraits/';
const MAX_SCENARIO = 5 * 1024 * 1024;               // символов JSON; карта высот ≈ 70 КБ, обычно сценарий меньше 200 КБ
const AUDIO_LIMITS = { voice: 15, sfx: 15, music: 40 };   // МБ
const REVISION_EVERY_MS = 10 * 60 * 1000;           // автосохранение частое — ревизия не чаще раза в 10 минут
const REVISIONS_KEEP = 30;

const parseJSON = (s, fb) => { try { return JSON.parse(s); } catch { return fb; } };
const allowedFor = (row, userId) => { const a = parseJSON(row.allowed_users || '[-1]', [-1]); return a.includes(-1) || a.includes(userId); };

// ---------- проверка сценария ----------
// Ссылки на файлы — только на свои папки assets (или локальные id из офлайн-режима без «://»).
// Старый портрет из демо — data:image, небольшой.
function badRef(v, prefixes) {
    if (v === undefined || v === null || v === '') return false;
    if (typeof v !== 'string') return true;
    if (v.startsWith('data:image/')) return !prefixes.includes(PORTRAIT_PREFIX) || v.length > 400000;
    if (v.startsWith('/assets/')) return !prefixes.some(p => v.startsWith(p)) || v.includes('..');
    return /:\/\/|^\/\//.test(v) || v.length > 200;
}
function checkScenario(sc) {
    if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return 'Сценарий должен быть объектом';
    if (!Array.isArray(sc.objects) || !Array.isArray(sc.steps)) return 'В сценарии нет objects или steps';
    delete sc.assets;                                  // вшитые файлы из экспорта на сервере не хранятся
    for (const st of sc.steps) if (st && st.voice && badRef(st.voice.id, [AUDIO_PREFIX])) return 'Недопустимая ссылка на озвучку';
    const snd = sc.sound || {};
    for (const s of Object.values(snd.sfx || {})) if (s && badRef(s.id, [AUDIO_PREFIX])) return 'Недопустимая ссылка на звук';
    for (const m of Object.values(snd.music || {})) if (m && badRef(m.id, [AUDIO_PREFIX])) return 'Недопустимая ссылка на музыку';
    for (const c of sc.cast || []) if (c && (badRef(c.image, [PORTRAIT_PREFIX]) || badRef(c.portrait, [PORTRAIT_PREFIX]))) return 'Недопустимая ссылка на портрет';
    const json = JSON.stringify(sc);
    if (json.length > MAX_SCENARIO) return 'Сценарий слишком большой';
    return null;
}
const metaOf = sc => { const m = (sc && sc.meta) || {};
    return { title:String(m.title || '').slice(0, 200), code:String(m.code || '').slice(0, 40), client:String(m.client || '').slice(0, 120) }; };

// Портреты персонажей из каталога: у игрока нет доступа к API каталога, поэтому картинку и кадр
// (если брифинг не задал свой) сервер подставляет сам.
function resolveCast(db, sc) {
    const ids = [...new Set((sc.cast || []).map(c => Number(c.characterId)).filter(Number.isInteger))];
    if (!ids.length) return Promise.resolve(sc);
    return new Promise(res => db.all(`SELECT * FROM global_characters WHERE id IN (${ids.map(() => '?').join(',')})`, ids, (err, rows) => {
        if (err) { Logger.error('briefing cast:', err.message); return res(sc); }
        const byId = new Map(rows.map(r => [r.id, r]));
        for (const c of sc.cast) { const gc = byId.get(Number(c.characterId)); if (!gc) continue;
            if (gc.image) c.image = gc.image;
            if (!c.frame || c.frame.inherit !== false) { const p = portraitForClient(gc);
                c.frame = { inherit:true, scale:p.portraitScale, xRel:p.portraitXRel, yRel:p.portraitYRel, mirror:p.portraitMirror }; } }
        res(sc);
    }));
}

// ---------- игрок ----------
function playerRoutes(db) {
    const r = express.Router();

    // Список доступных брифингов и число непрослушанных (метка на «ЗАПИСИ»).
    r.get('/', (req, res) => {
        db.all(`SELECT b.id, b.title, b.code, b.client, b.allowed_users, b.updated_at, v.times, v.last_listened
                FROM briefings b LEFT JOIN briefing_views v ON v.briefing_id = b.id AND v.user_id = ?
                WHERE b.is_active = 1 ORDER BY b.sort_order, b.id`, [req.session.userId], (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения брифингов' });
            const list = rows.filter(b => allowedFor(b, req.session.userId)).map(b => ({
                id:b.id, title:b.title, code:b.code, client:b.client, updatedAt:b.updated_at,
                listened:!!b.times, times:b.times || 0, lastListened:b.last_listened || null }));
            res.json({ briefings:list, unread:list.filter(b => !b.listened).length });
        });
    });

    r.get('/:id', (req, res) => {
        db.get('SELECT * FROM briefings WHERE id = ? AND is_active = 1', [req.params.id], async (err, b) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения брифинга' });
            if (!b || !allowedFor(b, req.session.userId)) return res.status(404).json({ message: 'Брифинг недоступен' });
            const sc = await resolveCast(db, parseJSON(b.scenario, {}));
            res.json({ briefing:{ id:b.id, title:b.title, code:b.code, client:b.client }, scenario:sc });
        });
    });

    // Плеер дошёл до финального экрана — брифинг прослушан.
    r.post('/:id/listened', (req, res) => {
        db.get('SELECT id, allowed_users FROM briefings WHERE id = ? AND is_active = 1', [req.params.id], (err, b) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (!b || !allowedFor(b, req.session.userId)) return res.status(404).json({ message: 'Брифинг недоступен' });
            db.run(`INSERT INTO briefing_views (user_id, briefing_id, times) VALUES (?, ?, 1)
                    ON CONFLICT(user_id, briefing_id) DO UPDATE SET times = times + 1, last_listened = CURRENT_TIMESTAMP`,
                [req.session.userId, b.id], e => e ? res.status(500).json({ message: 'Ошибка' }) : res.json({ ok:true }));
        });
    });
    return r;
}

// ---------- студия ----------
function editorRoutes(db) {
    const r = express.Router();
    const rowOut = b => ({ id:b.id, title:b.title, code:b.code, client:b.client, allowed_users:b.allowed_users, is_active:b.is_active,
        sort_order:b.sort_order, version:b.version, created_at:b.created_at, updated_at:b.updated_at });
    const one = (id, cb) => db.get('SELECT * FROM briefings WHERE id = ?', [id], cb);

    r.get('/briefings', (req, res) => {
        db.all(`SELECT b.*, (SELECT COUNT(*) FROM briefing_views v WHERE v.briefing_id = b.id) AS listeners,
                       length(b.scenario) AS size FROM briefings b ORDER BY b.sort_order, b.id`, (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения брифингов' });
            res.json({ briefings:rows.map(b => Object.assign(rowOut(b), { listeners:b.listeners, size:b.size })) });
        });
    });

    // Черновик или опубликованный — студии отдаётся любой, с подставленными портретами каталога.
    r.get('/briefings/:id', (req, res) => one(req.params.id, async (err, b) => {
        if (err) return res.status(500).json({ message: 'Ошибка' });
        if (!b) return res.status(404).json({ message: 'Брифинг не найден' });
        res.json({ briefing:rowOut(b), scenario:parseJSON(b.scenario, {}) });
    }));
    r.get('/briefings/:id/resolved', (req, res) => one(req.params.id, async (err, b) => {
        if (err || !b) return res.status(404).json({ message: 'Брифинг не найден' });
        res.json({ briefing:rowOut(b), scenario:await resolveCast(db, parseJSON(b.scenario, {})) });
    }));

    r.post('/briefings', (req, res) => {
        const sc = req.body && req.body.scenario, bad = checkScenario(sc);
        if (bad) return res.status(400).json({ message:bad });
        const m = metaOf(sc);
        db.get('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM briefings', (e, row) => {
            db.run(`INSERT INTO briefings (title, code, client, scenario, sort_order) VALUES (?, ?, ?, ?, ?)`,
                [m.title, m.code, m.client, JSON.stringify(sc), row ? row.n : 0], function (err) {
                    if (err) return res.status(500).json({ message: 'Ошибка создания брифинга' });
                    one(this.lastID, (e2, b) => res.json({ briefing:rowOut(b) }));
                });
        });
    });

    // Сохранение сценария. version — версия, с которой начинал редактор: если в базе уже новее,
    // значит, брифинг сохранили из другого окна — 409, чтобы не затереть чужую работу молча.
    r.put('/briefings/:id', (req, res) => {
        const { scenario:sc, version, force } = req.body || {}, bad = checkScenario(sc);
        if (bad) return res.status(400).json({ message:bad });
        one(req.params.id, (err, b) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (!b) return res.status(404).json({ message: 'Брифинг не найден' });
            if (!force && Number(version) !== b.version) return res.status(409).json({ message: 'Брифинг изменён в другом окне', version:b.version, updated_at:b.updated_at });
            const m = metaOf(sc), json = JSON.stringify(sc);
            db.get('SELECT saved_at FROM briefing_revisions WHERE briefing_id = ? ORDER BY id DESC LIMIT 1', [b.id], (e, last) => {
                const lastT = last ? Date.parse(last.saved_at.replace(' ', 'T') + 'Z') : 0;
                if (Date.now() - lastT > REVISION_EVERY_MS) {
                    db.run('INSERT INTO briefing_revisions (briefing_id, version, scenario) VALUES (?, ?, ?)', [b.id, b.version, b.scenario]);
                    db.run(`DELETE FROM briefing_revisions WHERE briefing_id = ? AND id NOT IN
                            (SELECT id FROM briefing_revisions WHERE briefing_id = ? ORDER BY id DESC LIMIT ${REVISIONS_KEEP})`, [b.id, b.id]);
                }
                db.run(`UPDATE briefings SET scenario = ?, title = ?, code = ?, client = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [json, m.title, m.code, m.client, b.id], e2 => {
                        if (e2) return res.status(500).json({ message: 'Ошибка сохранения' });
                        one(b.id, (e3, nb) => res.json({ briefing:rowOut(nb) }));
                    });
            });
        });
    });

    // Метаданные без сценария: доступ, активность, порядок. Версию сценария не трогает.
    r.patch('/briefings/:id', (req, res) => {
        const b = req.body || {}, set = [], args = [];
        if (b.allowed_users !== undefined) { const a = Array.isArray(b.allowed_users) ? b.allowed_users.map(Number).filter(Number.isInteger) : [-1];
            set.push('allowed_users = ?'); args.push(JSON.stringify(a.length ? a : [-1])); }
        if (b.is_active !== undefined) { set.push('is_active = ?'); args.push(b.is_active ? 1 : 0); }
        if (b.sort_order !== undefined && Number.isFinite(Number(b.sort_order))) { set.push('sort_order = ?'); args.push(Math.round(Number(b.sort_order))); }
        if (!set.length) return res.status(400).json({ message: 'Нечего менять' });
        db.run(`UPDATE briefings SET ${set.join(', ')} WHERE id = ?`, [...args, req.params.id], function (err) {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (!this.changes) return res.status(404).json({ message: 'Брифинг не найден' });
            one(req.params.id, (e, nb) => res.json({ briefing:rowOut(nb) }));
        });
    });

    r.delete('/briefings/:id', (req, res) => {
        const id = req.params.id;
        db.serialize(() => {
            db.run('DELETE FROM briefing_views WHERE briefing_id = ?', [id]);
            db.run('DELETE FROM briefing_revisions WHERE briefing_id = ?', [id]);
            db.run('DELETE FROM briefings WHERE id = ?', [id], function (err) {
                if (err) return res.status(500).json({ message: 'Ошибка удаления' });
                res.json({ ok:!!this.changes });
            });
        });
    });

    r.post('/briefings/:id/duplicate', (req, res) => one(req.params.id, (err, b) => {
        if (err || !b) return res.status(404).json({ message: 'Брифинг не найден' });
        const sc = parseJSON(b.scenario, {}); sc.meta = Object.assign({}, sc.meta, { title:((sc.meta && sc.meta.title) || 'Брифинг') + ' (копия)' });
        const m = metaOf(sc);
        db.run(`INSERT INTO briefings (title, code, client, scenario, allowed_users, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
            [m.title, m.code, m.client, JSON.stringify(sc), b.allowed_users, b.sort_order + 1], function (e) {
                if (e) return res.status(500).json({ message: 'Ошибка' });
                one(this.lastID, (e2, nb) => res.json({ briefing:rowOut(nb) }));
            });
    }));

    // Кто прослушал брифинг; сброс отметки (запись снова станет новой).
    r.get('/briefings/:id/listeners', (req, res) => {
        db.all(`SELECT v.user_id, u.username, v.times, v.first_listened, v.last_listened FROM briefing_views v
                JOIN users u ON u.id = v.user_id WHERE v.briefing_id = ? ORDER BY v.last_listened DESC`, [req.params.id], (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            res.json({ listeners:rows });
        });
    });
    r.delete('/briefings/:id/listeners', (req, res) => {
        const uid = req.query.user ? Number(req.query.user) : null;
        db.run(`DELETE FROM briefing_views WHERE briefing_id = ?${uid ? ' AND user_id = ?' : ''}`, uid ? [req.params.id, uid] : [req.params.id],
            function (err) { err ? res.status(500).json({ message: 'Ошибка' }) : res.json({ removed:this.changes }); });
    });

    r.get('/briefings/:id/revisions', (req, res) => {
        db.all('SELECT id, version, saved_at, length(scenario) AS size FROM briefing_revisions WHERE briefing_id = ? ORDER BY id DESC', [req.params.id],
            (err, rows) => err ? res.status(500).json({ message: 'Ошибка' }) : res.json({ revisions:rows }));
    });
    r.get('/briefings/:id/revisions/:rid', (req, res) => {
        db.get('SELECT scenario FROM briefing_revisions WHERE id = ? AND briefing_id = ?', [req.params.rid, req.params.id], (err, row) => {
            if (err || !row) return res.status(404).json({ message: 'Ревизия не найдена' });
            res.json({ scenario:parseJSON(row.scenario, {}) });
        });
    });

    // Загрузка озвучки, своих звуков и музыки брифинга.
    fs.mkdirSync(AUDIO_DIR, { recursive:true });
    r.post('/briefings/upload-audio', (req, res) => {
        const kind = AUDIO_LIMITS[req.query.kind] ? req.query.kind : 'sfx';
        const up = multer({
            storage:multer.diskStorage({
                destination:(rq, f, cb) => cb(null, AUDIO_DIR),
                filename:(rq, f, cb) => cb(null, `${kind}_${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(f.originalname).toLowerCase()}`)
            }),
            limits:{ fileSize:AUDIO_LIMITS[kind] * 1024 * 1024 },
            fileFilter:(rq, f, cb) => /\.(wav|mp3|ogg)$/i.test(f.originalname) && /^(audio|video)\/(x-)?(wav|wave|vnd\.wave|mpeg|mp3|ogg)$/i.test(f.mimetype)
                ? cb(null, true) : cb(new Error('Только аудиофайлы: mp3, ogg, wav'))
        }).single('file');
        up(req, res, err => {
            if (err) return res.status(400).json({ message:err.code === 'LIMIT_FILE_SIZE' ? `Файл больше ${AUDIO_LIMITS[kind]} МБ` : err.message });
            if (!req.file) return res.status(400).json({ message: 'Файл не загружен' });
            if (!validateAudioMagicBytes(req.file)) { try { fs.unlinkSync(req.file.path); } catch {} return res.status(400).json({ message: 'Файл не является корректным аудиофайлом' }); }
            res.json({ path:AUDIO_PREFIX + req.file.filename, name:req.file.originalname, size:req.file.size });
        });
    });
    return r;
}

module.exports = { playerRoutes, editorRoutes, checkScenario };
