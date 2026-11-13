// Диалоги: сами диалоги, их персонажи, реплики, ветки, выборы, экспорт.
const express = require('express');
const Logger = require('../../utils/logger');
const { sanitizeAssetPath } = require('./shared');

module.exports = (db, upload) => {
    const router = express.Router();

    // ==================== ДИАЛОГИ ====================
    
    // Получить все диалоги
    router.get('/dialogues', (req, res) => {
        db.all(`SELECT * FROM dialogues ORDER BY created_at DESC`, (err, dialogues) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения диалогов' });
            res.json({ dialogues });
        });
    });

    // Получить диалог по ID или frequency
    router.get('/dialogues/:id', (req, res) => {
        const { id } = req.params;
        const isNumeric = !isNaN(id);
        
        const query = isNumeric 
            ? 'SELECT * FROM dialogues WHERE id = ?'
            : 'SELECT * FROM dialogues WHERE frequency = ?';
        
        db.get(query, [id], (err, dialogue) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения диалога' });
            if (!dialogue) return res.status(404).json({ message: 'Диалог не найден' });
            
            // Получаем персонажей
            db.all(`SELECT c.*, gc.name as gc_name, gc.image as gc_image, gc.portrait_scale as gc_portrait_scale, gc.portrait_x as gc_portrait_x, gc.portrait_y as gc_portrait_y, gc.portrait_mirror as gc_portrait_mirror, gc.portrait_x_rel as gc_portrait_x_rel, gc.portrait_y_rel as gc_portrait_y_rel, gc.default_relation FROM characters c LEFT JOIN global_characters gc ON c.global_character_id = gc.id WHERE c.dialogue_id = ? ORDER BY c.sort_order`, [dialogue.id], (err, characters) => {
                if (err) return res.status(500).json({ message: 'Ошибка получения персонажей' });
                
                // Получаем ветки
                db.all('SELECT * FROM conversation_branches WHERE dialogue_id = ?', [dialogue.id], (err, branches) => {
                    if (err) return res.status(500).json({ message: 'Ошибка получения веток' });
                    
                    // Получаем все реплики для всех веток
                    const branchIds = branches.map(b => b.branch_id);
                    const placeholders = branchIds.map(() => '?').join(',');
                    
                    db.all(`SELECT c.*, ch.name as character_name 
                            FROM conversations c 
                            LEFT JOIN characters ch ON c.character_id = ch.id
                            WHERE c.dialogue_id = ? 
                            ORDER BY c.branch_id, c.sort_order`, 
                        [dialogue.id], (err, conversations) => {
                        if (err) return res.status(500).json({ message: 'Ошибка получения реплик' });
                        
                        // Получаем выборы для реплик
                        const convIds = conversations.map(c => c.id);
                        if (convIds.length === 0) {
                            res.json({ dialogue, characters, branches, conversations, choices: [], variants: [] });
                            return;
                        }

                        db.all(`SELECT * FROM choice_options WHERE conversation_id IN (${convIds.map(() => '?').join(',')}) ORDER BY sort_order`,
                            convIds, (err, choices) => {
                            if (err) return res.status(500).json({ message: 'Ошибка получения выборов' });
                            db.all(`SELECT * FROM conversation_variants WHERE conversation_id IN (${convIds.map(() => '?').join(',')})`,
                                convIds, (err, variants) => {
                                if (err) return res.status(500).json({ message: 'Ошибка получения вариантов реплик' });
                                db.all('SELECT edge_key, points FROM dialogue_edge_points WHERE dialogue_id = ?', [dialogue.id], (err, rows) => {
                                    if (err) return res.status(500).json({ message: 'Ошибка получения перемычек' });
                                    const edgePoints = {};
                                    (rows || []).forEach(r => { try { edgePoints[r.edge_key] = JSON.parse(r.points); } catch { /* битая запись */ } });
                                    res.json({ dialogue, characters, branches, conversations, choices, variants, edgePoints });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    // Создать диалог
    router.post('/dialogues', (req, res) => {
        const { frequency, title, allowedUsers, isActive, maxRepeats } = req.body;
        
        if (!frequency) {
            return res.status(400).json({ message: 'Frequency обязательна' });
        }
        
        db.run(`INSERT INTO dialogues (frequency, title, allowed_users, is_active, max_repeats) VALUES (?, ?, ?, ?, ?)`,
            [frequency, title || frequency, JSON.stringify(allowedUsers || [-1]), isActive !== undefined ? (isActive ? 1 : 0) : 1, maxRepeats !== undefined ? maxRepeats : 1],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ message: 'Диалог с такой частотой уже существует' });
                    }
                    return res.status(500).json({ message: 'Ошибка создания диалога' });
                }
                
                // Создаем главную ветку
                db.run(`INSERT INTO conversation_branches (dialogue_id, branch_id) VALUES (?, 'main')`,
                    [this.lastID], (err) => {
                        if (err) Logger.error('Error creating main branch:', err);
                    });
                
                res.status(201).json({ 
                    message: 'Диалог создан', 
                    dialogueId: this.lastID 
                });
            });
    });

    // Обновить диалог
    router.put('/dialogues/:id', (req, res) => {
        const { id } = req.params;
        const { frequency, title, allowedUsers, isActive, maxRepeats } = req.body;
        
        db.run(`UPDATE dialogues SET frequency = ?, title = ?, allowed_users = ?, is_active = ?, max_repeats = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [frequency, title, JSON.stringify(allowedUsers || [-1]), isActive !== undefined ? (isActive ? 1 : 0) : 1, maxRepeats !== undefined ? maxRepeats : 1, id],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка обновления диалога' });
                if (this.changes === 0) return res.status(404).json({ message: 'Диалог не найден' });
                res.json({ message: 'Диалог обновлен' });
            });
    });

    // Удалить диалог
    router.delete('/dialogues/:id', (req, res) => {
        const { id } = req.params;
        
        db.get('SELECT frequency FROM dialogues WHERE id = ?', [id], (err, dialogue) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения диалога' });
            if (!dialogue) return res.status(404).json({ message: 'Диалог не найден' });
            
            const frequency = dialogue.frequency;
            
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                
                db.run('DELETE FROM dialogue_access WHERE frequency = ?', [frequency], (err) => {
                    if (err) Logger.error('Error deleting dialogue_access:', err);
                });
                
                db.run('DELETE FROM dialogue_progress WHERE frequency = ?', [frequency], (err) => {
                    if (err) Logger.error('Error deleting dialogue_progress:', err);
                });
                
                db.run('DELETE FROM user_choices WHERE frequency = ?', [frequency], (err) => {
                    if (err) Logger.error('Error deleting user_choices:', err);
                });
                
                db.run('DELETE FROM dialogue_repeats WHERE frequency = ?', [frequency], (err) => {
                    if (err) Logger.error('Error deleting dialogue_repeats:', err);
                });
                
                db.all('SELECT id FROM conversations WHERE dialogue_id = ?', [id], (err, conversations) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ message: 'Ошибка получения реплик' });
                    }
                    
                    const convIds = conversations.map(c => c.id);
                    let deleteChoices = Promise.resolve();
                    
                    if (convIds.length > 0) {
                        const placeholders = convIds.map(() => '?').join(',');
                        deleteChoices = new Promise((resolve, reject) => {
                            db.run(`DELETE FROM choice_options WHERE conversation_id IN (${placeholders})`, convIds, (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    }
                    
                    deleteChoices.then(() => {
                        db.run('DELETE FROM conversations WHERE dialogue_id = ?', [id], (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ message: 'Ошибка удаления реплик' });
                            }
                            
                            db.run('DELETE FROM conversation_branches WHERE dialogue_id = ?', [id], (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ message: 'Ошибка удаления веток' });
                                }
                                
                                db.run('DELETE FROM characters WHERE dialogue_id = ?', [id], (err) => {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ message: 'Ошибка удаления персонажей' });
                                    }
                                    
                                    db.run('DELETE FROM dialogues WHERE id = ?', [id], function(err) {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ message: 'Ошибка удаления диалога' });
                                        }
                                        
                                        db.run('COMMIT');
                                        res.json({ message: 'Диалог и все связанные данные удалены' });
                                    });
                                });
                            });
                        });
                    }).catch(err => {
                        db.run('ROLLBACK');
                        res.status(500).json({ message: 'Ошибка удаления выборов' });
                    });
                });
            });
        });
    });

    // ==================== ПЕРСОНАЖИ ====================
    
    router.post('/characters', (req, res) => {
        const { dialogueId, globalCharacterId, voice, voiceMode, voiceDuration, window } = req.body;
        
        if (!dialogueId || !globalCharacterId) {
            return res.status(400).json({ message: 'dialogueId и globalCharacterId обязательны' });
        }
        
        db.get('SELECT name FROM global_characters WHERE id = ?', [globalCharacterId], (err, gc) => {
            if (err || !gc) return res.status(400).json({ message: 'Глобальный персонаж не найден' });
            
            db.run(`INSERT INTO characters (dialogue_id, name, image, global_character_id, voice, voice_mode, voice_duration, window) VALUES (?, ?, '', ?, ?, ?, ?, ?)`,
                [dialogueId, gc.name, globalCharacterId, voice || '', voiceMode || 'none', voiceDuration || 0, window || 1],
                function(err) {
                    if (err) return res.status(500).json({ message: 'Ошибка создания персонажа' });
                    res.status(201).json({ message: 'Персонаж создан', characterId: this.lastID });
                });
        });
    });

    router.put('/characters/:id', (req, res) => {
        const { id } = req.params;
        const { voice, voiceMode, voiceDuration, window } = req.body;
        
        db.run(`UPDATE characters SET voice = ?, voice_mode = ?, voice_duration = ?, window = ? WHERE id = ?`,
            [voice || '', voiceMode || 'none', voiceDuration || 0, window || 1, id],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка обновления персонажа' });
                if (this.changes === 0) return res.status(404).json({ message: 'Персонаж не найден' });
                res.json({ message: 'Персонаж обновлен' });
            });
    });

    // Удалить персонажа
    router.delete('/characters/:id', (req, res) => {
        db.run('DELETE FROM characters WHERE id = ?', [req.params.id], function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка удаления персонажа' });
            if (this.changes === 0) return res.status(404).json({ message: 'Персонаж не найден' });
            res.json({ message: 'Персонаж удален' });
        });
    });

    // ==================== РЕПЛИКИ ====================
    
    // Создать реплику
router.post('/conversations', (req, res) => {
        const { dialogueId, branchId, characterId, text, customImage, fakeName, voiceline, typingSpeed, sortOrder } = req.body;
        
        if (!dialogueId || !characterId || !text) {
            return res.status(400).json({ message: 'dialogueId, characterId и text обязательны' });
        }
        
        db.run(`INSERT INTO conversations (dialogue_id, branch_id, character_id, text, custom_image, fake_name, voiceline, typing_speed, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [dialogueId, branchId || 'main', characterId, text, customImage, fakeName, voiceline, typingSpeed || 0, sortOrder || 0],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка создания реплики' });
                res.status(201).json({ message: 'Реплика создана', conversationId: this.lastID });
            });
    });

    // ==================== ВАРИАНТЫ РЕПЛИК ДЛЯ СОСЛОВИЙ ====================
    // Основная реплика — для Лансера. Вариант заменяет её для аудитории: cavalier (Кавалер в Доме)
    // или exile (Кавалер-изгнанник). Своя озвучка обязательна к своему тексту.
    const AUDIENCES = ['cavalier', 'exile'];
    const assetOrEmpty = value => {
        if (value === undefined || value === null || value === '') return '';
        const safe = typeof value === 'string' ? sanitizeAssetPath(value) : null;
        return safe;   // null — недопустимый путь
    };

    router.put('/conversations/:id/variants/:audience', (req, res) => {
        const { id, audience } = req.params;
        if (!AUDIENCES.includes(audience)) return res.status(400).json({ message: 'Неизвестная аудитория варианта' });

        const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
        if (!text) return res.status(400).json({ message: 'Текст варианта обязателен' });
        if (text.length > 5000) return res.status(400).json({ message: 'Текст варианта слишком длинный' });

        const voiceline = assetOrEmpty(req.body.voiceline);
        const customImage = assetOrEmpty(req.body.customImage);
        if (voiceline === null || customImage === null) return res.status(400).json({ message: 'Недопустимый путь файла' });
        const fakeName = typeof req.body.fakeName === 'string' ? req.body.fakeName.trim().slice(0, 100) : '';
        const typingSpeed = Math.max(0, Math.min(500, parseFloat(req.body.typingSpeed) || 0));

        db.get('SELECT id FROM conversations WHERE id = ?', [id], (err, conversation) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (!conversation) return res.status(404).json({ message: 'Реплика не найдена' });
            db.run(`INSERT INTO conversation_variants (conversation_id, audience, text, voiceline, fake_name, custom_image, typing_speed, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                    ON CONFLICT(conversation_id, audience) DO UPDATE SET
                        text = excluded.text,
                        voiceline = excluded.voiceline,
                        fake_name = excluded.fake_name,
                        custom_image = excluded.custom_image,
                        typing_speed = excluded.typing_speed,
                        updated_at = CURRENT_TIMESTAMP`,
                [id, audience, text, voiceline, fakeName, customImage, typingSpeed],
                function(err) {
                    if (err) return res.status(500).json({ message: 'Ошибка сохранения варианта' });
                    res.json({ message: 'Вариант сохранён' });
                });
        });
    });

    router.delete('/conversations/:id/variants/:audience', (req, res) => {
        const { id, audience } = req.params;
        if (!AUDIENCES.includes(audience)) return res.status(400).json({ message: 'Неизвестная аудитория варианта' });
        db.run('DELETE FROM conversation_variants WHERE conversation_id = ? AND audience = ?', [id, audience], function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка удаления варианта' });
            res.json({ message: this.changes ? 'Вариант удалён' : 'Варианта не было' });
        });
    });

    router.put('/conversations/:id', (req, res) => {
        const { id } = req.params;
        const { branchId, characterId, text, customImage, fakeName, voiceline, typingSpeed, sortOrder } = req.body;
        
        db.run(`UPDATE conversations SET branch_id = ?, character_id = ?, text = ?, custom_image = ?, fake_name = ?, voiceline = ?, typing_speed = ?, sort_order = ? WHERE id = ?`,
            [branchId, characterId, text, customImage, fakeName, voiceline, typingSpeed || 0, sortOrder, id],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка обновления реплики' });
                if (this.changes === 0) return res.status(404).json({ message: 'Реплика не найдена' });
                res.json({ message: 'Реплика обновлена' });
            });
    });

    // Удалить реплику
    router.delete('/conversations/:id', (req, res) => {
        const conversationId = req.params.id;
        
        db.get('SELECT * FROM conversations WHERE id = ?', [conversationId], (err, conv) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения реплики' });
            if (!conv) return res.status(404).json({ message: 'Реплика не найдена' });
            
            db.all('SELECT * FROM choice_options WHERE conversation_id = ?', [conversationId], (err, choices) => {
                if (err) return res.status(500).json({ message: 'Ошибка получения выборов' });
                
                if (choices.length > 0) {
                    const targetBranches = choices
                        .filter(ch => ch.target_branch)
                        .map(ch => ch.target_branch);
                    
                    const deleteBranches = () => {
                        let completed = 0;
                        const total = targetBranches.length;
                        
                        if (total === 0) {
                            deleteChoicesAndConversation();
                            return;
                        }
                        
                        targetBranches.forEach(branchId => {
                            db.run('DELETE FROM conversations WHERE dialogue_id = ? AND branch_id = ?', 
                                [conv.dialogue_id, branchId], (err) => {
                                    if (err) Logger.error('Error deleting conversations in branch:', err);
                                    
                                    db.run('DELETE FROM conversation_branches WHERE dialogue_id = ? AND branch_id = ?', 
                                        [conv.dialogue_id, branchId], (err) => {
                                            if (err) Logger.error('Error deleting branch:', err);
                                            completed++;
                                            if (completed === total) {
                                                deleteChoicesAndConversation();
                                            }
                                        });
                                });
                        });
                    };
                    
                    const deleteChoicesAndConversation = () => {
                        db.run('DELETE FROM choice_options WHERE conversation_id = ?', [conversationId], (err) => {
                            if (err) Logger.error('Error deleting choices:', err);
                            
                            db.run('DELETE FROM conversations WHERE id = ?', [conversationId], function(err) {
                                if (err) return res.status(500).json({ message: 'Ошибка удаления реплики' });
                                res.json({ message: 'Реплика и связанные данные удалены' });
                            });
                        });
                    };
                    
                    deleteBranches();
                } else {
                    db.run('DELETE FROM conversations WHERE id = ?', [conversationId], function(err) {
                        if (err) return res.status(500).json({ message: 'Ошибка удаления реплики' });
                        res.json({ message: 'Реплика удалена' });
                    });
                }
            });
        });
    });

    // ==================== ВЕТКИ ====================
    
    // Создать ветку с репликой и выбором (для новых веток из choices)
    router.post('/branches/with-conversation', (req, res) => {
        const { dialogueId, branchId, characterId, conversationId, choiceId, optionId, optionText, sortOrder } = req.body;
        const relation = relationFields(req.body);
        const estateTexts = optionEstateTexts(req.body);
        
        if (!dialogueId || !branchId || !characterId) {
            return res.status(400).json({ message: 'dialogueId, branchId и characterId обязательны' });
        }
        
        db.serialize(() => {
            db.run('BEGIN TRANSACTION');
            
            db.run(`INSERT INTO conversation_branches (dialogue_id, branch_id) VALUES (?, ?)`,
                [dialogueId, branchId], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        if (err.message.includes('UNIQUE')) {
                            return res.status(400).json({ message: 'Ветка с таким ID уже существует' });
                        }
                        return res.status(500).json({ message: 'Ошибка создания ветки' });
                    }
                    
                    db.run(`INSERT INTO conversations (dialogue_id, branch_id, character_id, text, sort_order) VALUES (?, ?, ?, ?, ?)`,
                        [dialogueId, branchId, characterId, '[Новая реплика - отредактируйте]', 0], (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ message: 'Ошибка создания реплики' });
                            }
                            
                            db.run(`INSERT INTO choice_options (conversation_id, choice_id, option_id, option_text, target_branch, sort_order,
                                        relation_global_char_id, relation_require_min, relation_require_max, relation_effect,
                                        option_text_cavalier, option_text_exile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [conversationId, choiceId, optionId, optionText, branchId, sortOrder || 0,
                                 relation.charId, relation.min, relation.max, relation.effect,
                                 estateTexts.cavalier, estateTexts.exile], function(err) {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        return res.status(500).json({ message: 'Ошибка создания выбора' });
                                    }
                                    
                                    db.run('COMMIT');
                                    res.status(201).json({ 
                                        message: 'Ветка, реплика и выбор созданы', 
                                        branchId,
                                        choiceOptionId: this.lastID 
                                    });
                                });
                        });
                });
        });
    });
    
    // Создать ветку
    router.post('/branches', (req, res) => {
        const { dialogueId, branchId, parentChoiceId } = req.body;
        
        if (!dialogueId || !branchId) {
            return res.status(400).json({ message: 'dialogueId и branchId обязательны' });
        }
        
        db.run(`INSERT INTO conversation_branches (dialogue_id, branch_id, parent_choice_id) VALUES (?, ?, ?)`,
            [dialogueId, branchId, parentChoiceId],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ message: 'Ветка с таким ID уже существует' });
                    }
                    return res.status(500).json({ message: 'Ошибка создания ветки' });
                }
                res.status(201).json({ message: 'Ветка создана' });
            });
    });

    // Удалить ветку
    router.delete('/branches/:dialogueId/:branchId', (req, res) => {
        const { dialogueId, branchId } = req.params;
        
        if (branchId === 'main') {
            return res.status(400).json({ message: 'Нельзя удалить главную ветку' });
        }
        
        db.run('DELETE FROM conversation_branches WHERE dialogue_id = ? AND branch_id = ?', 
            [dialogueId, branchId], function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка удаления ветки' });
                
                // Удаляем реплики ветки
                db.run('DELETE FROM conversations WHERE dialogue_id = ? AND branch_id = ?', 
                    [dialogueId, branchId]);
                
                res.json({ message: 'Ветка удалена' });
            });
    });

    // Создать sequential связь между репликами
    // Создать связь A → B (протягивание связи в студии).
    // B и все реплики после неё в её ветке переезжают в конец ветки A — так отрезанное ножницами
    // дерево пришивается обратно целиком. Нельзя: если у A уже есть следующая реплика или выбор,
    // если B — начало ветки ответа, и если связь замкнёт цикл.
    router.post('/conversations/link', (req, res) => {
        const { fromConversationId, toConversationId } = req.body;
        if (!fromConversationId || !toConversationId) {
            return res.status(400).json({ message: 'fromConversationId и toConversationId обязательны' });
        }
        if (String(fromConversationId) === String(toConversationId)) {
            return res.status(400).json({ message: 'Нельзя связать реплику саму с собой' });
        }
        db.all('SELECT * FROM conversations WHERE id IN (?, ?)', [fromConversationId, toConversationId], (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения реплик' });
            const from = rows.find(r => String(r.id) === String(fromConversationId));
            const to = rows.find(r => String(r.id) === String(toConversationId));
            if (!from || !to) return res.status(404).json({ message: 'Реплика не найдена' });

            db.get('SELECT id FROM choice_options WHERE conversation_id = ? LIMIT 1', [from.id], (err, fromChoice) => {
                if (err) return res.status(500).json({ message: 'Ошибка проверки выбора' });
                if (fromChoice) return res.status(400).json({ message: 'У исходной реплики есть выбор: она ведёт в ветки ответов' });

                db.get('SELECT id FROM conversations WHERE dialogue_id = ? AND branch_id = ? AND sort_order > ? LIMIT 1',
                    [from.dialogue_id, from.branch_id, from.sort_order], (err, next) => {
                    if (err) return res.status(500).json({ message: 'Ошибка получения реплик' });
                    if (next) return res.status(400).json({ message: 'У реплики уже есть следующая. Сначала обрежьте ту связь ножницами' });

                    db.all(`SELECT id, sort_order FROM conversations WHERE dialogue_id = ? AND branch_id = ? AND sort_order >= ?
                            ORDER BY sort_order, id`, [to.dialogue_id, to.branch_id, to.sort_order], (err, tail) => {
                        if (err) return res.status(500).json({ message: 'Ошибка получения реплик' });
                        if (tail.some(t => t.id === from.id)) {
                            return res.status(400).json({ message: 'Связь замкнёт диалог в круг' });
                        }
                        db.get(`SELECT COUNT(*) AS n FROM conversations WHERE dialogue_id = ? AND branch_id = ? AND sort_order < ?`,
                            [to.dialogue_id, to.branch_id, to.sort_order], (err, before) => {
                            if (err) return res.status(500).json({ message: 'Ошибка получения реплик' });
                            const isBranchStart = before.n === 0;
                            db.get('SELECT id FROM choice_options WHERE target_branch = ? AND target_branch != ? LIMIT 1',
                                [to.branch_id, 'main'], (err, choiceInto) => {
                                if (err) return res.status(500).json({ message: 'Ошибка проверки выбора' });
                                if (isBranchStart && choiceInto) {
                                    return res.status(400).json({ message: 'Реплика — начало ветки ответа. Сначала обрежьте связь ответа ножницами' });
                                }
                                if (isBranchStart && to.branch_id === 'main') {
                                    return res.status(400).json({ message: 'Это начало диалога — к нему нельзя присоединить' });
                                }
                                db.serialize(() => {
                                    db.run('BEGIN TRANSACTION');
                                    tail.forEach((t, i) => db.run('UPDATE conversations SET branch_id = ?, sort_order = ? WHERE id = ?',
                                        [from.branch_id, from.sort_order + 1 + i, t.id]));
                                    db.run('COMMIT', (err) => {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ message: 'Ошибка создания связи' });
                                        }
                                        res.json({ message: 'Связь создана', moved: tail.length });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });

    // Сдвинуть sort_order реплик в ветке (для вставки перед)
    router.post('/conversations/shift', (req, res) => {
        const { dialogueId, branchId, fromSortOrder } = req.body;
        
        if (!dialogueId || !branchId || fromSortOrder === undefined) {
            return res.status(400).json({ message: 'dialogueId, branchId и fromSortOrder обязательны' });
        }
        
        db.all(
            'SELECT id, sort_order FROM conversations WHERE dialogue_id = ? AND branch_id = ? AND sort_order >= ? ORDER BY sort_order DESC',
            [dialogueId, branchId, fromSortOrder],
            (err, convs) => {
                if (err) return res.status(500).json({ message: 'Ошибка получения реплик' });
                
                let done = 0;
                if (convs.length === 0) return res.json({ message: 'ОК' });
                
                convs.forEach(conv => {
                    db.run('UPDATE conversations SET sort_order = ? WHERE id = ?',
                        [conv.sort_order + 1, conv.id],
                        (err) => {
                            if (err) Logger.error('Error shifting conversation:', err);
                            done++;
                            if (done === convs.length) res.json({ message: 'ОК' });
                        }
                    );
                });
            }
        );
    });

    // Перемычки линии связи (студия): пустой список — линия снова идёт напрямую.
    router.put('/dialogues/:id/edge-points', (req, res) => {
        const { edgeKey, points } = req.body;
        if (typeof edgeKey !== 'string' || !/^(seq:\d+:\d+|choice:\d+)$/.test(edgeKey)) {
            return res.status(400).json({ message: 'Неизвестная связь' });
        }
        if (!Array.isArray(points) || points.length > 30) return res.status(400).json({ message: 'Некорректные точки' });
        const clean = points.map(p => ({
            dx: Math.round(Math.max(-20000, Math.min(20000, Number(p?.dx) || 0)) * 10) / 10,
            dy: Math.round(Math.max(-20000, Math.min(20000, Number(p?.dy) || 0)) * 10) / 10
        }));
        const done = err => err ? res.status(500).json({ message: 'Ошибка сохранения перемычек' }) : res.json({ message: 'Сохранено' });
        if (!clean.length) {
            return db.run('DELETE FROM dialogue_edge_points WHERE dialogue_id = ? AND edge_key = ?', [req.params.id, edgeKey], done);
        }
        db.run(`INSERT INTO dialogue_edge_points (dialogue_id, edge_key, points, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(dialogue_id, edge_key) DO UPDATE SET points = excluded.points, updated_at = CURRENT_TIMESTAMP`,
            [req.params.id, edgeKey, JSON.stringify(clean)], done);
    });

    // Обрезать связь в дереве (ножницы в студии).
    //  - sequential: A → B внутри ветки. B и всё после неё уходят в новую ветку detached_*,
    //    порядок сохраняется; ветка до A остаётся на месте.
    //  - choice: ответ → ветка. Ответ остаётся, но больше никуда не ведёт (диалог на нём завершается).
    router.post('/conversations/cut', (req, res) => {
        const { type, fromConversationId, toConversationId, choiceOptionId } = req.body;

        if (type === 'choice') {
            if (!choiceOptionId) return res.status(400).json({ message: 'choiceOptionId обязателен' });
            return db.run('UPDATE choice_options SET target_branch = NULL WHERE id = ?', [choiceOptionId], function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка обрезки связи' });
                if (this.changes === 0) return res.status(404).json({ message: 'Ответ не найден' });
                db.run('DELETE FROM dialogue_edge_points WHERE edge_key = ?', [`choice:${choiceOptionId}`]);
                res.json({ message: 'Связь ответа обрезана' });
            });
        }

        if (type !== 'sequential' || !fromConversationId || !toConversationId) {
            return res.status(400).json({ message: 'Неизвестная связь' });
        }
        db.all('SELECT * FROM conversations WHERE id IN (?, ?)', [fromConversationId, toConversationId], (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения реплик' });
            const from = rows.find(r => String(r.id) === String(fromConversationId));
            const to = rows.find(r => String(r.id) === String(toConversationId));
            if (!from || !to) return res.status(404).json({ message: 'Реплика не найдена' });
            if (from.branch_id !== to.branch_id || to.sort_order < from.sort_order) {
                return res.status(400).json({ message: 'Реплики не связаны напрямую' });
            }
            db.all(`SELECT id FROM conversations WHERE dialogue_id = ? AND branch_id = ? AND sort_order >= ?
                    ORDER BY sort_order, id`, [to.dialogue_id, to.branch_id, to.sort_order], (err, tail) => {
                if (err) return res.status(500).json({ message: 'Ошибка получения реплик' });
                const tailIds = tail.map(t => t.id);
                // to — первая в хвосте; если между from и to есть реплики, связи нет.
                if (tailIds[0] !== to.id) return res.status(400).json({ message: 'Реплики не связаны напрямую' });
                const detachedBranch = `detached_${Date.now()}`;
                db.serialize(() => {
                    db.run('BEGIN TRANSACTION');
                    db.run('INSERT INTO conversation_branches (dialogue_id, branch_id) VALUES (?, ?)', [to.dialogue_id, detachedBranch]);
                    db.run('DELETE FROM dialogue_edge_points WHERE dialogue_id = ? AND edge_key = ?', [to.dialogue_id, `seq:${from.id}:${to.id}`]);
                    tailIds.forEach((id, i) => db.run('UPDATE conversations SET branch_id = ?, sort_order = ? WHERE id = ?', [detachedBranch, i, id]));
                    db.run('COMMIT', (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ message: 'Ошибка обрезки связи' });
                        }
                        res.json({ message: 'Связь обрезана', newBranch: detachedBranch, moved: tailIds.length });
                    });
                });
            });
        });
    });

    // Отсоединить реплику (перенести в отдельную ветку)
    router.post('/conversations/unlink', (req, res) => {
        const { conversationId } = req.body;
        
        if (!conversationId) {
            return res.status(400).json({ message: 'conversationId обязателен' });
        }
        
        db.serialize(() => {
            db.get('SELECT * FROM conversations WHERE id = ?', [conversationId], (err, conv) => {
                if (err) return res.status(500).json({ message: 'Ошибка получения реплики' });
                if (!conv) return res.status(404).json({ message: 'Реплика не найдена' });
                
                db.get('SELECT id FROM choice_options WHERE conversation_id = ?', [conversationId], (err, choice) => {
                    if (err) return res.status(500).json({ message: 'Ошибка проверки выбора' });
                    if (choice) return res.status(400).json({ message: 'Нельзя отсоединить реплику с выбором' });
                    
                    const detachedBranch = `detached_${Date.now()}`;
                    
                    db.run('INSERT INTO conversation_branches (dialogue_id, branch_id) VALUES (?, ?)',
                        [conv.dialogue_id, detachedBranch],
                        (err) => {
                            if (err) return res.status(500).json({ message: 'Ошибка создания ветки' });
                            
                            db.run('UPDATE conversations SET branch_id = ?, sort_order = 0 WHERE id = ?',
                                [detachedBranch, conversationId],
                                (err) => {
                                    if (err) return res.status(500).json({ message: 'Ошибка отсоединения' });
                                    res.json({ message: 'Реплика отсоединена', newBranch: detachedBranch });
                                }
                            );
                        }
                    );
                });
            });
        });
    });

    // ==================== ВЫБОРЫ ====================
    
    // Создать выбор
    // Отношения варианта ответа: без персонажа ответ ни на чьё отношение не влияет,
    // пороги и эффект тогда сбрасываются, чтобы не остались «висящие» значения.
    function relationFields(body) {
        const charId = parseInt(body.relationGlobalCharId) || null;
        const num = (v, fallback) => Number.isFinite(parseInt(v)) ? Math.max(-100, Math.min(100, parseInt(v))) : fallback;
        if (!charId) return { charId: null, min: -100, max: 100, effect: 0 };
        return { charId, min: num(body.relationRequireMin, -100), max: num(body.relationRequireMax, 100), effect: num(body.relationEffect, 0) };
    }

    // Текст ответа для Кавалера в Доме и для изгнанника; пусто — основной текст.
    function optionEstateTexts(body) {
        const clean = v => (typeof v === 'string' ? v.trim().slice(0, 1000) : '');
        return { cavalier: clean(body.optionTextCavalier), exile: clean(body.optionTextExile) };
    }

    router.post('/choices', (req, res) => {
        const { conversationId, choiceId, optionId, optionText, targetBranch, sortOrder } = req.body;

        if (!conversationId || !choiceId || !optionId || !optionText) {
            return res.status(400).json({ message: 'Не все обязательные поля заполнены' });
        }
        const relation = relationFields(req.body);
        const estateTexts = optionEstateTexts(req.body);

        db.run(`INSERT INTO choice_options (conversation_id, choice_id, option_id, option_text, target_branch, sort_order,
                    relation_global_char_id, relation_require_min, relation_require_max, relation_effect,
                    option_text_cavalier, option_text_exile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [conversationId, choiceId, optionId, optionText, targetBranch, sortOrder || 0,
             relation.charId, relation.min, relation.max, relation.effect, estateTexts.cavalier, estateTexts.exile],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка создания выбора' });
                res.status(201).json({ message: 'Выбор создан', choiceOptionId: this.lastID });
            });
    });

    router.put('/choices/:id', (req, res) => {
        const { id } = req.params;
        const { choiceId, optionId, optionText, targetBranch, sortOrder } = req.body;
        const relation = relationFields(req.body);
        const estateTexts = optionEstateTexts(req.body);

        db.run(`UPDATE choice_options SET choice_id = ?, option_id = ?, option_text = ?, target_branch = ?, sort_order = ?,
                    relation_global_char_id = ?, relation_npc_id = NULL, relation_require_min = ?, relation_require_max = ?, relation_effect = ?,
                    option_text_cavalier = ?, option_text_exile = ? WHERE id = ?`,
            [choiceId, optionId, optionText, targetBranch, sortOrder,
             relation.charId, relation.min, relation.max, relation.effect,
             estateTexts.cavalier, estateTexts.exile, id],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка обновления выбора' });
                if (this.changes === 0) return res.status(404).json({ message: 'Выбор не найден' });
                res.json({ message: 'Выбор обновлен' });
            });
    });

    // Удалить выбор
    router.delete('/choices/:id', (req, res) => {
        db.run('DELETE FROM choice_options WHERE id = ?', [req.params.id], function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка удаления выбора' });
            if (this.changes === 0) return res.status(404).json({ message: 'Выбор не найден' });
            res.json({ message: 'Выбор удален' });
        });
    });

    // ==================== ЭКСПОРТ ДИАЛОГА ====================
    
    // Получить диалог в формате для клиента
    router.get('/export/:frequency', (req, res) => {
        const { frequency } = req.params;
        
        db.get('SELECT * FROM dialogues WHERE frequency = ?', [frequency], (err, dialogue) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (!dialogue) return res.status(404).json({ message: 'Диалог не найден' });
            
            const dialogueId = dialogue.id;
            
            // Получаем персонажей
            db.all(`SELECT c.*, gc.name as gc_name, gc.image as gc_image, gc.portrait_scale as gc_portrait_scale, gc.portrait_x as gc_portrait_x, gc.portrait_y as gc_portrait_y, gc.portrait_mirror as gc_portrait_mirror, gc.portrait_x_rel as gc_portrait_x_rel, gc.portrait_y_rel as gc_portrait_y_rel, gc.default_relation FROM characters c LEFT JOIN global_characters gc ON c.global_character_id = gc.id WHERE c.dialogue_id = ? ORDER BY c.sort_order`, [dialogueId], (err, characters) => {
                if (err) return res.status(500).json({ message: 'Ошибка' });
                
                // Получаем все реплики
                db.all(`SELECT * FROM conversations WHERE dialogue_id = ? ORDER BY branch_id, sort_order`, 
                    [dialogueId], (err, conversations) => {
                    if (err) return res.status(500).json({ message: 'Ошибка' });
                    
                    // Получаем все выборы
                    const convIds = conversations.map(c => c.id);
                    if (convIds.length === 0) {
                        res.json(formatDialogueExport(dialogue, characters, [], []));
                        return;
                    }
                    
                    db.all(`SELECT * FROM choice_options WHERE conversation_id IN (${convIds.map(() => '?').join(',')}) ORDER BY sort_order`, 
                        convIds, (err, choices) => {
                        if (err) return res.status(500).json({ message: 'Ошибка' });
                        res.json(formatDialogueExport(dialogue, characters, conversations, choices));
                    });
                });
            });
        });
    });

// Форматирование диалога для клиента
    function formatDialogueExport(dialogue, characters, conversations, choices) {
        const result = {
            frequency: dialogue.frequency,
            characters: characters.map(c => ({
                name: c.gc_name || c.name,
                image: c.gc_image || c.image,
                voice: c.voice,
                voiceMode: c.voice_mode || 'none',
                voiceDuration: c.voice_duration,
                window: c.window
            })),
            allowedUsers: JSON.parse(dialogue.allowed_users || '[-1]'),
            isActive: dialogue.is_active !== 0,
            maxRepeats: dialogue.max_repeats !== undefined ? dialogue.max_repeats : 1,
            conversations: []
        };
        
        // Группируем реплики по веткам
        const branches = {};
        conversations.forEach(c => {
            if (!branches[c.branch_id]) {
                branches[c.branch_id] = [];
            }
            
            const convChoices = choices.filter(ch => ch.conversation_id === c.id);
            const char = characters.find(ch => ch.id === c.character_id);
            
const convObj = {
                speaker: char ? char.name : 'Система',
                text: c.text
            };
            
            if (c.custom_image) convObj.image = c.custom_image;
            if (c.fake_name) convObj.fakeName = c.fake_name;
            if (c.voiceline) convObj.voiceline = c.voiceline;
            if (c.typing_speed && c.typing_speed > 0) convObj.typingSpeed = c.typing_speed;
            
            if (convChoices.length > 0) {
                const choice = convChoices[0];
                convObj.hasChoice = true;
                convObj.choice = {
                    choiceId: choice.choice_id,
                    options: convChoices.map(ch => {
                        const opt = {
                            id: ch.option_id,
                            text: ch.option_text,
                            targetBranch: ch.target_branch
                        };
                        if ((ch.relation_global_char_id !== null && ch.relation_global_char_id !== undefined) || (ch.relation_npc_id !== null && ch.relation_npc_id !== undefined)) {
                            const gcId = ch.relation_global_char_id || ch.relation_npc_id;
                            if (gcId) {
                                opt.relationGlobalCharId = gcId;
                                opt.relationRequireMin = ch.relation_require_min !== null ? ch.relation_require_min : -100;
                                opt.relationRequireMax = ch.relation_require_max !== null ? ch.relation_require_max : 100;
                                opt.relationEffect = ch.relation_effect || 0;
                            }
                        }
                        return opt;
                    })
                };
            }
            
            branches[c.branch_id].push(convObj);
        });
        
        // Главная ветка
        result.conversations = branches['main'] || [];
        
        // Добавляем ветки в нужном формате
        Object.keys(branches).forEach(branchId => {
            if (branchId !== 'main') {
                result[branchId] = {
                    choiceId: branchId,
                    responses: branches[branchId]
                };
            }
        });
        
        return result;
    }

    // ==================== ГЕНЕРАЦИЯ ID ====================
    
    router.get('/generate-id/:prefix', (req, res) => {
        const { prefix } = req.params;
        const id = `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        res.json({ id });
    });

    return router;
};
