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
            db.all('SELECT * FROM characters WHERE dialogue_id = ? ORDER BY sort_order', [dialogue.id], (err, characters) => {
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
    
// Создать персонажа
    router.post('/characters', (req, res) => {
        const { dialogueId, name, image, voice, voiceMode, voiceDuration, window } = req.body;
        
        if (!dialogueId || !name) {
            return res.status(400).json({ message: 'dialogueId и name обязательны' });
        }
        
        db.run(`INSERT INTO characters (dialogue_id, name, image, voice, voice_mode, voice_duration, window) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [dialogueId, name, image, voice || '', voiceMode || 'none', voiceDuration || 0, window || 1],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка создания персонажа' });
                res.status(201).json({ message: 'Персонаж создан', characterId: this.lastID });
            });
    });

    router.put('/characters/:id', (req, res) => {
        const { id } = req.params;
        const { name, image, voice, voiceMode, voiceDuration, window } = req.body;
        
        db.run(`UPDATE characters SET name = ?, image = ?, voice = ?, voice_mode = ?, voice_duration = ?, window = ? WHERE id = ?`,
            [name, image, voice || '', voiceMode || 'none', voiceDuration, window, id],
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
                            
                            db.run(`INSERT INTO choice_options (conversation_id, choice_id, option_id, option_text, target_branch, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
                                [conversationId, choiceId, optionId, optionText, branchId, sortOrder || 0], (err) => {
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
                            const fromSortOrder = fromConv.sort_order || 0;
                            
                            db.all(
                                'SELECT * FROM conversations WHERE dialogue_id = ? AND branch_id = ? AND sort_order > ? ORDER BY sort_order',
                                [dialogueId, targetBranch, fromSortOrder],
                                (err, afterConvs) => {
                                    if (err) return res.status(500).json({ message: 'Ошибка получения реплик' });
                                    
                                    const detachedBranch = `detached_${Date.now()}`;
                                    let moveDetached = Promise.resolve();
                                    
                                    if (afterConvs.length > 0) {
                                        moveDetached = new Promise((resolve, reject) => {
                                            db.run(
                                                'INSERT INTO conversation_branches (dialogue_id, branch_id) VALUES (?, ?)',
                                                [dialogueId, detachedBranch],
                                                (err) => {
                                                    if (err) return reject(err);
                                                    
                                                    let moved = 0;
                                                    afterConvs.forEach((conv, idx) => {
                                                        db.run(
                                                            'UPDATE conversations SET branch_id = ?, sort_order = ? WHERE id = ?',
                                                            [detachedBranch, idx, conv.id],
                                                            (err) => {
                                                                if (err) Logger.error('Error moving conversation:', err);
                                                                moved++;
                                                                if (moved === afterConvs.length) resolve();
                                                            }
                                                        );
                                                    });
                                                    if (afterConvs.length === 0) resolve();
                                                }
                                            );
                                        });
                                    }
                                    
                                    moveDetached.then(() => {
                                        db.run(
                                            'UPDATE conversations SET branch_id = ?, sort_order = ? WHERE id = ?',
                                            [targetBranch, fromSortOrder + 1, toConversationId],
                                            (err) => {
                                                if (err) return res.status(500).json({ message: 'Ошибка создания связи' });
                                                res.json({ message: 'Связь создана' });
                                            }
                                        );
                                    }).catch(err => {
                                        Logger.error('Error:', err);
                                        res.status(500).json({ message: 'Ошибка пересоздания цепочки' });
                                    });
                                }
                            );
                        });
                    });
                });
            });
        });
    });

    // ==================== ВЫБОРЫ ====================
    
    // Создать выбор
    router.post('/choices', (req, res) => {
        const { conversationId, choiceId, optionId, optionText, targetBranch, sortOrder } = req.body;
        
        if (!conversationId || !choiceId || !optionId || !optionText) {
            return res.status(400).json({ message: 'Не все обязательные поля заполнены' });
        }
        
        db.run(`INSERT INTO choice_options (conversation_id, choice_id, option_id, option_text, target_branch, sort_order) VALUES (?, ?, ?, ?, ?, ?)`,
            [conversationId, choiceId, optionId, optionText, targetBranch, sortOrder || 0],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка создания выбора' });
                res.status(201).json({ message: 'Выбор создан', choiceOptionId: this.lastID });
            });
    });

    // Обновить выбор
    router.put('/choices/:id', (req, res) => {
        const { id } = req.params;
        const { choiceId, optionId, optionText, targetBranch, sortOrder } = req.body;
        
        db.run(`UPDATE choice_options SET choice_id = ?, option_id = ?, option_text = ?, target_branch = ?, sort_order = ? WHERE id = ?`,
            [choiceId, optionId, optionText, targetBranch, sortOrder, id],
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
            db.all('SELECT * FROM characters WHERE dialogue_id = ? ORDER BY sort_order', [dialogueId], (err, characters) => {
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
                name: c.name,
                image: c.image,
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
                    options: convChoices.map(ch => ({
                        id: ch.option_id,
                        text: ch.option_text,
                        targetBranch: ch.target_branch
                    }))
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
