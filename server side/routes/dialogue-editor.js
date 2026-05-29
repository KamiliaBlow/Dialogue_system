const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const Logger = require('../utils/logger');

const dialogueEditorRoutes = (db, upload) => {
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
            db.all(`SELECT c.*, gc.name as gc_name, gc.image as gc_image, gc.portrait_scale as gc_portrait_scale, gc.portrait_x as gc_portrait_x, gc.portrait_y as gc_portrait_y, gc.portrait_mirror as gc_portrait_mirror, gc.default_relation FROM characters c LEFT JOIN global_characters gc ON c.global_character_id = gc.id WHERE c.dialogue_id = ? ORDER BY c.sort_order`, [dialogue.id], (err, characters) => {
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
                            res.json({ dialogue, characters, branches, conversations, choices: [] });
                            return;
                        }
                        
                        db.all(`SELECT * FROM choice_options WHERE conversation_id IN (${convIds.map(() => '?').join(',')}) ORDER BY sort_order`, 
                            convIds, (err, choices) => {
                            if (err) return res.status(500).json({ message: 'Ошибка получения выборов' });
                            res.json({ dialogue, characters, branches, conversations, choices });
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
                            
                            db.run(`INSERT INTO choice_options (conversation_id, choice_id, option_id, option_text, target_branch, sort_order, relation_npc_id, relation_require_min, relation_require_max, relation_effect) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [conversationId, choiceId, optionId, optionText, branchId, sortOrder || 0, null, -100, 100, 0], (err) => {
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
    router.post('/conversations/link', (req, res) => {
        const { fromConversationId, toConversationId } = req.body;
        
        if (!fromConversationId || !toConversationId) {
            return res.status(400).json({ message: 'fromConversationId и toConversationId обязательны' });
        }
        
        if (fromConversationId === toConversationId) {
            return res.status(400).json({ message: 'Нельзя связать реплику саму с собой' });
        }
        
        db.serialize(() => {
            db.get('SELECT * FROM conversations WHERE id = ?', [fromConversationId], (err, fromConv) => {
                if (err) return res.status(500).json({ message: 'Ошибка получения исходной реплики' });
                if (!fromConv) return res.status(404).json({ message: 'Исходная реплика не найдена' });
                
                db.get('SELECT * FROM conversations WHERE id = ?', [toConversationId], (err, toConv) => {
                    if (err) return res.status(500).json({ message: 'Ошибка получения целевой реплики' });
                    if (!toConv) return res.status(404).json({ message: 'Целевая реплика не найдена' });
                    
                    db.get('SELECT id FROM choice_options WHERE conversation_id = ?', [fromConversationId], (err, fromChoice) => {
                        if (err) return res.status(500).json({ message: 'Ошибка проверки выбора' });
                        if (fromChoice) return res.status(400).json({ message: 'Исходная реплика имеет выбор' });
                        
                        db.get('SELECT id FROM choice_options WHERE conversation_id = ?', [toConversationId], (err, toChoice) => {
                            if (err) return res.status(500).json({ message: 'Ошибка проверки выбора' });
                            if (toChoice) return res.status(400).json({ message: 'Целевая реплика имеет выбор' });
                            
                            const dialogueId = fromConv.dialogue_id;
                            const targetBranch = fromConv.branch_id;
                            
                            db.get(
                                'SELECT MAX(sort_order) as maxSort FROM conversations WHERE dialogue_id = ? AND branch_id = ?',
                                [dialogueId, targetBranch],
                                (err, row) => {
                                    if (err) return res.status(500).json({ message: 'Ошибка получения реплик' });
                                    
                                    const newSortOrder = (row.maxSort || 0) + 1;
                                    
                                    db.run(
                                        'UPDATE conversations SET branch_id = ?, sort_order = ? WHERE id = ?',
                                        [targetBranch, newSortOrder, toConversationId],
                                        (err) => {
                                            if (err) return res.status(500).json({ message: 'Ошибка создания связи' });
                                            res.json({ message: 'Связь создана' });
                                        }
                                    );
                                }
                            );
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
    router.post('/choices', (req, res) => {
        const { conversationId, choiceId, optionId, optionText, targetBranch, sortOrder, relationGlobalCharId, relationRequireMin, relationRequireMax, relationEffect } = req.body;
        
        if (!conversationId || !choiceId || !optionId || !optionText) {
            return res.status(400).json({ message: 'Не все обязательные поля заполнены' });
        }
        
        db.run(`INSERT INTO choice_options (conversation_id, choice_id, option_id, option_text, target_branch, sort_order, relation_global_char_id, relation_require_min, relation_require_max, relation_effect) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [conversationId, choiceId, optionId, optionText, targetBranch, sortOrder || 0,
             relationGlobalCharId || null,
             relationRequireMin !== undefined ? relationRequireMin : -100,
             relationRequireMax !== undefined ? relationRequireMax : 100,
             relationEffect || 0],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка создания выбора' });
                res.status(201).json({ message: 'Выбор создан', choiceOptionId: this.lastID });
            });
    });

    router.put('/choices/:id', (req, res) => {
        const { id } = req.params;
        const { choiceId, optionId, optionText, targetBranch, sortOrder, relationGlobalCharId, relationRequireMin, relationRequireMax, relationEffect } = req.body;
        
        db.run(`UPDATE choice_options SET choice_id = ?, option_id = ?, option_text = ?, target_branch = ?, sort_order = ?, relation_global_char_id = ?, relation_require_min = ?, relation_require_max = ?, relation_effect = ? WHERE id = ?`,
            [choiceId, optionId, optionText, targetBranch, sortOrder,
             relationGlobalCharId || null,
             relationRequireMin !== undefined ? relationRequireMin : -100,
             relationRequireMax !== undefined ? relationRequireMax : 100,
             relationEffect || 0, id],
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

    // ==================== ГЛОБАЛЬНЫЕ ПЕРСОНАЖИ ====================

    router.get('/global-characters', (req, res) => {
        db.all('SELECT * FROM global_characters ORDER BY name', (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения персонажей' });
            res.json({ characters: rows });
        });
    });

    router.post('/global-characters', upload.single('portrait'), (req, res) => {
        const { name, defaultRelation, keepImage } = req.body;
        let image;
        if (req.file) {
            image = `/assets/images/portraits/${req.file.filename}`;
        } else if (keepImage) {
            image = `/assets/images/portraits/${keepImage}`;
        } else {
            image = null;
        }
        const rel = defaultRelation !== undefined ? Math.max(-100, Math.min(100, parseInt(defaultRelation) || 0)) : 0;
        const ps = parseFloat(req.body.portraitScale) || 1.0;
        const px = parseFloat(req.body.portraitX) || 0;
        const py = parseFloat(req.body.portraitY) || 0;
        const pm = req.body.portraitMirror === '1' || req.body.portraitMirror === true ? 1 : 0;

        if (!name) return res.status(400).json({ message: 'Имя обязательно' });

        db.run(`INSERT INTO global_characters (name, image, portrait_scale, portrait_x, portrait_y, portrait_mirror, default_relation) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [name, image, ps, px, py, pm, rel],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка создания персонажа' });
                res.status(201).json({ message: 'Персонаж создан', characterId: this.lastID });
            });
    });

    router.put('/global-characters/:id', upload.single('portrait'), (req, res) => {
        const { id } = req.params;
        const { name, defaultRelation, portraitScale, portraitX, portraitY, portraitMirror, keepImage } = req.body;
        const ps = parseFloat(portraitScale) || 1.0;
        const px = parseFloat(portraitX) || 0;
        const py = parseFloat(portraitY) || 0;
        const pm = portraitMirror === '1' || portraitMirror === true ? 1 : 0;
        const rel = defaultRelation !== undefined ? Math.max(-100, Math.min(100, parseInt(defaultRelation) || 0)) : 0;

        db.get('SELECT image FROM global_characters WHERE id = ?', [id], (err, existing) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (!existing) return res.status(404).json({ message: 'Персонаж не найден' });

            let image;
            if (req.file) {
                image = `/assets/images/portraits/${req.file.filename}`;
            } else if (keepImage && keepImage !== 'false' && keepImage !== '') {
                if (keepImage.startsWith('/assets/')) {
                    image = keepImage;
                } else {
                    image = `/assets/images/portraits/${keepImage}`;
                }
            } else if (keepImage === 'false' || keepImage === '') {
                image = null;
            } else {
                image = existing.image;
            }

            db.run(`UPDATE global_characters SET name = ?, image = ?, portrait_scale = ?, portrait_x = ?, portrait_y = ?, portrait_mirror = ?, default_relation = ? WHERE id = ?`,
                [name, image, ps, px, py, pm, rel, id],
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
                const total = gcs.length * users.length;
                if (total === 0) return res.json({ message: 'Нет пользователей' });

                gcs.forEach(gc => {
                    users.forEach(user => {
                        db.run(`INSERT INTO user_relations (user_id, global_character_id, relation_value)
                                VALUES (?, ?, ?)
                                ON CONFLICT(user_id, global_character_id) DO NOTHING`,
                            [user.id, gc.id, gc.default_relation || 0], (err) => {
                                count++;
                                if (count === total) res.json({ message: `Инициализировано ${total} отношений` });
                            });
                    });
                });
            });
        });
    });

    router.get('/global-characters/relations', (req, res) => {
        db.all(`SELECT ur.id, ur.user_id, u.username, ur.global_character_id,
                       gc.name as character_name, gc.image as character_image, ur.relation_value
                FROM user_relations ur
                JOIN users u ON ur.user_id = u.id
                JOIN global_characters gc ON ur.global_character_id = gc.id
                ORDER BY u.username, gc.name`, (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения отношений' });
            res.json({ relations: rows });
        });
    });

    router.get('/global-characters/:id/relations', (req, res) => {
        const { id } = req.params;
        db.get('SELECT id, name, default_relation FROM global_characters WHERE id = ?', [id], (err, gc) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            if (!gc) return res.status(404).json({ message: 'Персонаж не найден' });

            db.all(`SELECT ur.id, ur.user_id, u.username, ur.relation_value
                    FROM user_relations ur
                    JOIN users u ON ur.user_id = u.id
                    WHERE ur.global_character_id = ?
                    ORDER BY u.username`, [id], (err, rows) => {
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

    // ==================== ФАЙЛЫ ====================
    
    router.get('/files/portraits', (req, res) => {
        const portraitsDir = path.join(__dirname, '../assets/images/portraits');
        
        if (!fs.existsSync(portraitsDir)) {
            fs.mkdirSync(portraitsDir, { recursive: true });
            return res.json({ files: [] });
        }
        
        fs.readdir(portraitsDir, (err, files) => {
            if (err) {
                return res.json({ files: [] });
            }
            
            const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
            res.json({ files: imageFiles.map(f => `/assets/images/portraits/${f}`) });
        });
    });

    router.get('/files/sounds', (req, res) => {
        const soundsDir = path.join(__dirname, '../assets/sounds/voices');
        
        if (!fs.existsSync(soundsDir)) {
            fs.mkdirSync(soundsDir, { recursive: true });
            return res.json({ files: [] });
        }
        
        fs.readdir(soundsDir, (err, files) => {
            if (err) {
                return res.json({ files: [] });
            }
            
            const soundFiles = files.filter(f => /\.(wav|mp3|ogg)$/i.test(f));
            res.json({ files: soundFiles.map(f => `/assets/sounds/voices/${f}`) });
        });
    });

    router.get('/files/voicelines', (req, res) => {
        const voicelinesDir = path.join(__dirname, '../assets/sounds/voiceline');
        
        if (!fs.existsSync(voicelinesDir)) {
            fs.mkdirSync(voicelinesDir, { recursive: true });
            return res.json({ files: [] });
        }
        
        fs.readdir(voicelinesDir, (err, files) => {
            if (err) {
                return res.json({ files: [] });
            }
            
            const soundFiles = files.filter(f => /\.(wav|mp3|ogg)$/i.test(f));
            res.json({ files: soundFiles.map(f => `/assets/sounds/voiceline/${f}`) });
        });
    });

// Загрузить портрет
    router.post('/files/upload-portrait', upload.single('portrait'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'Файл не загружен' });
        }
        
        res.json({ 
            message: 'Файл загружен',
            path: `/assets/images/portraits/${req.file.filename}`,
            filename: req.file.filename
        });
    });

    router.post('/files/upload-sound', (req, res) => {
        const soundStorage = multer.diskStorage({
            destination: (req, file, cb) => {
                const uploadDir = path.join(__dirname, '../assets/sounds/voices');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = path.extname(file.originalname);
                cb(null, 'voice_' + uniqueSuffix + ext);
            }
        });
        
        const soundUpload = multer({ 
            storage: soundStorage,
            limits: { fileSize: 10 * 1024 * 1024 },
            fileFilter: (req, file, cb) => {
                const allowedTypes = /wav|mp3|ogg/;
                const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
                const mimetype = /audio|wav|mp3|mpeg|ogg/.test(file.mimetype);
                if (mimetype && extname) {
                    return cb(null, true);
                }
                cb(new Error('Только аудиофайлы разрешены'));
            }
        });
        
        soundUpload.single('sound')(req, res, (err) => {
            if (err) {
                return res.status(400).json({ message: err.message });
            }
            if (!req.file) {
                return res.status(400).json({ message: 'Файл не загружен' });
            }
            
            res.json({ 
                message: 'Файл загружен',
                path: `/assets/sounds/voices/${req.file.filename}`,
                filename: req.file.filename
            });
        });
    });

    router.post('/files/upload-voiceline', (req, res) => {
        const voicelineStorage = multer.diskStorage({
            destination: (req, file, cb) => {
                const uploadDir = path.join(__dirname, '../assets/sounds/voiceline');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = path.extname(file.originalname);
                cb(null, 'voiceline_' + uniqueSuffix + ext);
            }
        });
        
        const voicelineUpload = multer({ 
            storage: voicelineStorage,
            limits: { fileSize: 50 * 1024 * 1024 },
            fileFilter: (req, file, cb) => {
                const allowedTypes = /wav|mp3|ogg/;
                const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
                const mimetype = /audio|wav|mp3|mpeg|ogg/.test(file.mimetype);
                if (mimetype && extname) {
                    return cb(null, true);
                }
                cb(new Error('Только аудиофайлы разрешены'));
            }
        });
        
        voicelineUpload.single('voiceline')(req, res, (err) => {
            if (err) {
                return res.status(400).json({ message: err.message });
            }
            if (!req.file) {
                return res.status(400).json({ message: 'Файл не загружен' });
            }
            
            res.json({ 
                message: 'Файл загружен',
                path: `/assets/sounds/voiceline/${req.file.filename}`,
                filename: req.file.filename
            });
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
            db.all(`SELECT c.*, gc.name as gc_name, gc.image as gc_image, gc.portrait_scale as gc_portrait_scale, gc.portrait_x as gc_portrait_x, gc.portrait_y as gc_portrait_y, gc.portrait_mirror as gc_portrait_mirror, gc.default_relation FROM characters c LEFT JOIN global_characters gc ON c.global_character_id = gc.id WHERE c.dialogue_id = ? ORDER BY c.sort_order`, [dialogueId], (err, characters) => {
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

    router.get('/users', (req, res) => {
        db.all('SELECT id, username FROM users ORDER BY username', (err, users) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения пользователей' });
            res.json({ users });
        });
    });

    return router;
};

module.exports = dialogueEditorRoutes;
