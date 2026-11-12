// Каталог персонажей (global_characters) и отношения игроков с ними.
const express = require('express');
const path = require('path');
const fs = require('fs');
const { ASSETS_DIR, sanitizeAssetPath, validateImageMagicBytes } = require('./shared');
const { portraitFromBody } = require('../../utils/portrait');
const Logger = require('../../utils/logger');

module.exports = (db, upload) => {
    const router = express.Router();

    // ==================== ГЛОБАЛЬНЫЕ ПЕРСОНАЖИ ====================

    router.get('/global-characters', (req, res) => {
        db.all('SELECT * FROM global_characters ORDER BY name', (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения персонажей' });
            res.json({ characters: rows });
        });
    });

    router.post('/global-characters', upload.single('portrait'), (req, res) => {
        const { name, defaultRelation, keepImage } = req.body;

        // Проверка загруженного файла по сигнатурам (защита от замаскированных файлов).
        if (req.file && !validateImageMagicBytes(req.file)) {
            try { fs.unlinkSync(req.file.path); } catch {}
            return res.status(400).json({ message: 'Файл не является корректным изображением' });
        }

        let image;
        if (req.file) {
            image = `/assets/images/portraits/${req.file.filename}`;
        } else if (keepImage) {
            // keepImage должен указывать только на существующий файл в директории портретов.
            const candidate = keepImage.startsWith('/assets/')
                ? keepImage
                : `/assets/images/portraits/${path.basename(keepImage)}`;
            const safe = sanitizeAssetPath(candidate);
            if (!safe || !safe.startsWith('/assets/images/portraits/')) {
                return res.status(400).json({ message: 'Недопустимый путь изображения' });
            }
            // Проверяем, что файл реально существует.
            const physPath = path.join(ASSETS_DIR, safe.replace('/assets/', ''));
            if (!fs.existsSync(physPath)) {
                return res.status(400).json({ message: 'Указанное изображение не найдено' });
            }
            image = safe;
        } else {
            image = null;
        }
        const rel = defaultRelation !== undefined ? Math.max(-100, Math.min(100, parseInt(defaultRelation) || 0)) : 0;
        // Положение портрета: доли ширины рамки (новая студия) или пиксели (старый клиент).
        const portrait = portraitFromBody(req.body);

        if (!name || typeof name !== 'string' || name.trim() === '') return res.status(400).json({ message: 'Имя обязательно' });
        const safeName = name.trim().slice(0, 100);

        db.run(`INSERT INTO global_characters (name, image, portrait_scale, portrait_x, portrait_y, portrait_x_rel, portrait_y_rel, portrait_mirror, default_relation)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [safeName, image, portrait.scale, portrait.xPx, portrait.yPx, portrait.xRel, portrait.yRel, portrait.mirror, rel],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка создания персонажа' });
                res.status(201).json({ message: 'Персонаж создан', characterId: this.lastID });
            });
    });

    router.put('/global-characters/:id', upload.single('portrait'), (req, res) => {
        const { id } = req.params;
        const { name, defaultRelation, keepImage } = req.body;

        // Проверка загруженного файла по сигнатурам.
        if (req.file && !validateImageMagicBytes(req.file)) {
            try { fs.unlinkSync(req.file.path); } catch {}
            return res.status(400).json({ message: 'Файл не является корректным изображением' });
        }

        const portrait = portraitFromBody(req.body);
        const rel = defaultRelation !== undefined ? Math.max(-100, Math.min(100, parseInt(defaultRelation) || 0)) : 0;

        if (!name || typeof name !== 'string' || name.trim() === '') return res.status(400).json({ message: 'Имя обязательно' });
        const safeName = name.trim().slice(0, 100);

        db.get('SELECT image FROM global_characters WHERE id = ?', [id], (err, existing) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (!existing) return res.status(404).json({ message: 'Персонаж не найден' });

            let image;
            if (req.file) {
                image = `/assets/images/portraits/${req.file.filename}`;
            } else if (keepImage && keepImage !== 'false' && keepImage !== '') {
                const candidate = keepImage.startsWith('/assets/')
                    ? keepImage
                    : `/assets/images/portraits/${path.basename(keepImage)}`;
                const safe = sanitizeAssetPath(candidate);
                if (!safe || !safe.startsWith('/assets/images/portraits/')) {
                    return res.status(400).json({ message: 'Недопустимый путь изображения' });
                }
                const physPath = path.join(ASSETS_DIR, safe.replace('/assets/', ''));
                if (!fs.existsSync(physPath)) {
                    return res.status(400).json({ message: 'Указанное изображение не найдено' });
                }
                image = safe;
            } else if (keepImage === 'false' || keepImage === '') {
                image = null;
            } else {
                image = existing.image;
            }

            db.run(`UPDATE global_characters SET name = ?, image = ?, portrait_scale = ?, portrait_x = ?, portrait_y = ?,
                        portrait_x_rel = ?, portrait_y_rel = ?, portrait_mirror = ?, default_relation = ? WHERE id = ?`,
                [safeName, image, portrait.scale, portrait.xPx, portrait.yPx, portrait.xRel, portrait.yRel, portrait.mirror, rel, id],
                function(err) {
                    if (err) return res.status(500).json({ message: 'Ошибка обновления персонажа' });
                    if (this.changes === 0) return res.status(404).json({ message: 'Персонаж не найден' });
                    res.json({ message: 'Персонаж обновлен' });
                });
        });
    });

    router.delete('/global-characters/:id', (req, res) => {
        const { id } = req.params;
        db.get('SELECT COUNT(*) as cnt FROM characters WHERE global_character_id = ?', [id], (err, row) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (row && row.cnt > 0) {
                return res.status(400).json({ message: `Персонаж используется в ${row.cnt} диалогах. Сначала удалите его оттуда.` });
            }
            db.run('DELETE FROM user_relations WHERE global_character_id = ?', [id], (err) => {
                if (err) return res.status(500).json({ message: 'Ошибка удаления отношений' });
                db.run('DELETE FROM global_characters WHERE id = ?', [id], function(err) {
                    if (err) return res.status(500).json({ message: 'Ошибка удаления персонажа' });
                    if (this.changes === 0) return res.status(404).json({ message: 'Персонаж не найден' });
                    res.json({ message: 'Персонаж удален' });
                });
            });
        });
    });

    router.post('/global-characters/init-relations', (req, res) => {
        db.all('SELECT id, default_relation FROM global_characters', [], (err, gcs) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (gcs.length === 0) return res.json({ message: 'Нет персонажей' });

            db.all('SELECT id FROM users', [], (err, users) => {
                if (err) return res.status(500).json({ message: 'Ошибка' });

                let count = 0;
                let created = 0;
                let failed = 0;
                const total = gcs.length * users.length;
                if (total === 0) return res.json({ message: 'Нет пользователей' });

                // Стартовое значение — строка пилота 0. Уникальный ключ таблицы включает
                // pilot_profile_id; со старым ключом (user_id, global_character_id) каждая
                // вставка падала, а ответ всё равно сообщал об успехе.
                gcs.forEach(gc => {
                    users.forEach(user => {
                        db.run(`INSERT INTO user_relations (user_id, global_character_id, pilot_profile_id, relation_value)
                                VALUES (?, ?, 0, ?)
                                ON CONFLICT(user_id, global_character_id, pilot_profile_id) DO NOTHING`,
                            [user.id, gc.id, gc.default_relation || 0], function(err) {
                                if (err) failed++;
                                else created += this.changes;
                                count++;
                                if (count !== total) return;
                                if (failed) {
                                    Logger.error(`init-relations: ${failed} из ${total} вставок не удались`);
                                    return res.status(500).json({ message: `Ошибка: не удалось создать ${failed} из ${total} отношений` });
                                }
                                res.json({ message: created
                                    ? `Создано отношений: ${created} (уже были: ${total - created})`
                                    : 'Все отношения уже созданы' });
                            });
                    });
                });
            });
        });
    });

    router.get('/global-characters/relations', (req, res) => {
        db.all(`SELECT ur.id, ur.user_id, u.username, ur.global_character_id,
                       gc.name as character_name, gc.image as character_image,
                       ur.relation_value, ur.pilot_profile_id
                FROM user_relations ur
                JOIN users u ON ur.user_id = u.id
                JOIN global_characters gc ON ur.global_character_id = gc.id
                ORDER BY u.username, gc.name, ur.pilot_profile_id`, (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения отношений' });
            db.all('SELECT id, username FROM users ORDER BY username', [], (err, users) => {
                if (err) return res.status(500).json({ message: 'Ошибка' });
                res.json({ relations: rows, users: users || [] });
            });
        });
    });

    // Пилоты конкретного пользователя (для админских представлений отношений).
    router.get('/users/:userId/pilots', (req, res) => {
        const { userId } = req.params;
        db.all(`SELECT id, slot_number, callsign, full_name, is_active
                FROM pilot_profiles WHERE user_id = ? ORDER BY slot_number`, [userId], (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения пилотов' });
            res.json({ pilots: rows || [] });
        });
    });

    router.get('/global-characters/:id/relations', (req, res) => {
        const { id } = req.params;
        db.get('SELECT id, name, default_relation FROM global_characters WHERE id = ?', [id], (err, gc) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (!gc) return res.status(404).json({ message: 'Персонаж не найден' });

            db.all(`SELECT ur.id, ur.user_id, u.username, ur.relation_value, ur.pilot_profile_id
                    FROM user_relations ur
                    JOIN users u ON ur.user_id = u.id
                    WHERE ur.global_character_id = ?
                    ORDER BY u.username, ur.pilot_profile_id`, [id], (err, rows) => {
                if (err) return res.status(500).json({ message: 'Ошибка получения отношений' });

                db.all('SELECT id, username FROM users ORDER BY username', [], (err, allUsers) => {
                    if (err) return res.status(500).json({ message: 'Ошибка' });
                    res.json({ character: gc, relations: rows, users: allUsers });
                });
            });
        });
    });

    router.put('/global-characters/relation/:id', (req, res) => {
        const { id } = req.params;
        const { relationValue } = req.body;
        const val = Math.max(-100, Math.min(100, relationValue || 0));
        db.run('UPDATE user_relations SET relation_value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [val, id], function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка обновления отношения' });
                if (this.changes === 0) return res.status(404).json({ message: 'Запись не найдена' });
                res.json({ message: 'Отношение обновлено' });
            });
    });

    // Задать отношение пользователя с персонажем.
    // По умолчанию пишется стартовое значение (строка пилота 0);
    // global=true — значение дополнительно перезаписывается у всех пилотов аккаунта;
    // pilotProfileId>0 — записывается только отношение указанного пилота.
    router.put('/global-characters/:gcId/user/:userId/relation', (req, res) => {
        const { gcId, userId } = req.params;
        const val = Math.max(-100, Math.min(100, parseInt(req.body.relationValue) || 0));
        const isGlobal = req.body.global === true || req.body.global === 1 || req.body.global === '1';
        const pilotProfileId = parseInt(req.body.pilotProfileId) || 0;

        db.get('SELECT id FROM global_characters WHERE id = ?', [gcId], (err, gc) => {
            if (err) return res.status(500).json({ message: 'Ошибка сервера' });
            if (!gc) return res.status(404).json({ message: 'Персонаж не найден' });

            db.get('SELECT id FROM users WHERE id = ?', [userId], (err, user) => {
                if (err) return res.status(500).json({ message: 'Ошибка сервера' });
                if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

                // Отношение конкретного пилота — отдельная запись, без глобальной перезаписи.
                if (pilotProfileId > 0) {
                    db.get('SELECT id FROM pilot_profiles WHERE id = ? AND user_id = ?',
                        [pilotProfileId, userId], (err, pilot) => {
                            if (err) return res.status(500).json({ message: 'Ошибка сервера' });
                            if (!pilot) return res.status(404).json({ message: 'Пилот не найден' });
                            db.run(`INSERT INTO user_relations (user_id, global_character_id, pilot_profile_id, relation_value)
                                    VALUES (?, ?, ?, ?)
                                    ON CONFLICT(user_id, global_character_id, pilot_profile_id)
                                    DO UPDATE SET relation_value = excluded.relation_value, updated_at = CURRENT_TIMESTAMP`,
                                [userId, gcId, pilotProfileId, val], (err) => {
                                    if (err) return res.status(500).json({ message: 'Ошибка сохранения отношения' });
                                    res.json({ message: 'Отношение пилота сохранено', pilot_profile_id: pilotProfileId });
                                });
                        });
                    return;
                }

                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');

                    // Стартовое (общее) значение аккаунта — строка пилота 0.
                    db.run(`INSERT INTO user_relations (user_id, global_character_id, pilot_profile_id, relation_value)
                            VALUES (?, ?, 0, ?)
                            ON CONFLICT(user_id, global_character_id, pilot_profile_id)
                            DO UPDATE SET relation_value = excluded.relation_value, updated_at = CURRENT_TIMESTAMP`,
                        [userId, gcId, val], (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ message: 'Ошибка сохранения отношения' });
                            }

                            if (!isGlobal) {
                                db.run('COMMIT');
                                return res.json({ message: 'Начальное отношение сохранено', global: false });
                            }

                            // Глобальное значение: перезаписываем отношение у всех пилотов аккаунта.
                            db.run(`UPDATE user_relations SET relation_value = ?, updated_at = CURRENT_TIMESTAMP
                                    WHERE user_id = ? AND global_character_id = ? AND pilot_profile_id != 0`,
                                [val, userId, gcId], (err) => {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ message: 'Ошибка обновления пилотов' });
                                    }
                                    db.run('COMMIT');
                                    res.json({ message: 'Отношение установлено для всех пилотов аккаунта', global: true });
                                });
                        });
                });
            });
        });
    });

    router.get('/users', (req, res) => {
        db.all('SELECT id, username FROM users ORDER BY username', (err, users) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения пользователей' });
            res.json({ users });
        });
    });

    return router;
};
