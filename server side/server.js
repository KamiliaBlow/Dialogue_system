const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const config = require('./config');
const Logger = require('./utils/logger');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const { Validator, validateBody } = require('./utils/validator');

// Настройка загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'assets/images/portraits');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'portrait_' + uniqueSuffix + ext);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Только изображения разрешены'));
    }
});

config.validate();

const sslKeyPath = path.join(__dirname, config.SSL_KEY_PATH);
const sslCertPath = path.join(__dirname, config.SSL_CERT_PATH);
const hasSSL = fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath);

const app = express();

const allowedHeadersList = 'Content-Type, Authorization, X-Requested-With, Accept, Origin, Cache-Control, expires, pragma, if-modified-since, cache-control, x-request-id';

// CORS middleware с расширенной конфигурацией
const corsOptions = {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowedHeaders: allowedHeadersList.split(', '),
    exposedHeaders: ['Set-Cookie', 'Content-Length', 'X-Request-Id'],
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD');
    res.setHeader('Access-Control-Allow-Headers', allowedHeadersList);
    
    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }
    next();
});

const db = new sqlite3.Database(config.DB_PATH, (err) => {
    if (err) {
        Logger.error('Database connection error:', err.message);
    } else {
        Logger.info('Connected to SQLite database');
        initDatabase();
    }
});

app.use(express.json());
app.use('/DIALOGUE_rework/assets', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    next();
}, express.static(path.join(__dirname, 'assets')));
app.use('/assets', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    next();
}, express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: hasSSL,
        maxAge: config.SESSION_MAX_AGE,
        sameSite: hasSSL ? 'none' : 'lax',
        httpOnly: true,
        path: '/'
    },
    name: 'sessionId'
}));
app.use(Logger.request);

function initDatabase() {
    const tables = [
        `CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            is_admin BOOLEAN DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS dialogue_access (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            frequency TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(frequency, user_id)
        )`,
        `CREATE TABLE IF NOT EXISTS dialogue_progress (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            frequency TEXT NOT NULL,
            progress INTEGER DEFAULT 0,
            completed BOOLEAN DEFAULT 0,
            last_line INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(user_id, frequency)
        )`,
        `CREATE TABLE IF NOT EXISTS user_choices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            frequency TEXT NOT NULL,
            choice_id TEXT NOT NULL,
            option_id TEXT,
            choice_text TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )`,
        `CREATE TABLE IF NOT EXISTS dialogue_repeats (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            frequency TEXT NOT NULL,
            repeat_count INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users (id),
            UNIQUE(user_id, frequency)
        )`,
        `CREATE TABLE IF NOT EXISTS dialogues (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            frequency TEXT UNIQUE NOT NULL,
            title TEXT,
            allowed_users TEXT DEFAULT '[-1]',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dialogue_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            image TEXT,
            voice TEXT,
            voice_duration REAL DEFAULT 0,
            window INTEGER DEFAULT 1,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (dialogue_id) REFERENCES dialogues(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS conversation_branches (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dialogue_id INTEGER NOT NULL,
            branch_id TEXT NOT NULL,
            parent_choice_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (dialogue_id) REFERENCES dialogues(id) ON DELETE CASCADE,
            UNIQUE(dialogue_id, branch_id)
        )`,
        `CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            dialogue_id INTEGER NOT NULL,
            branch_id TEXT NOT NULL DEFAULT 'main',
            character_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            custom_image TEXT,
            fake_name TEXT,
            sort_order INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (dialogue_id) REFERENCES dialogues(id) ON DELETE CASCADE,
            FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE SET NULL
        )`,
        `CREATE TABLE IF NOT EXISTS choice_options (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            choice_id TEXT NOT NULL,
            option_id TEXT NOT NULL,
            option_text TEXT NOT NULL,
            target_branch TEXT,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS uploaded_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            original_name TEXT NOT NULL,
            file_type TEXT NOT NULL,
            file_path TEXT NOT NULL,
            file_size INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`
    ];
    
tables.forEach(sql => db.run(sql));
    
    db.run(`ALTER TABLE characters ADD COLUMN voice_mode TEXT DEFAULT 'none'`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (voice_mode):', err.message);
        }
    });
    
    db.run(`ALTER TABLE conversations ADD COLUMN voiceline TEXT DEFAULT ''`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (voiceline):', err.message);
        }
    });
    
    db.run(`ALTER TABLE dialogues ADD COLUMN is_active INTEGER DEFAULT 1`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (is_active):', err.message);
        }
    });
    
    db.run(`ALTER TABLE dialogues ADD COLUMN max_repeats INTEGER DEFAULT 1`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (max_repeats):', err.message);
        }
    });
    
    db.run(`ALTER TABLE user_choices ADD COLUMN option_id TEXT`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (option_id):', err.message);
        }
    });
}

const authRoutes = express.Router();

authRoutes.post('/register', validateBody({
    username: Validator.username,
    password: Validator.password
}), async (req, res) => {
    const { username, password } = req.sanitizedBody;
    
    db.get('SELECT id FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка сервера' });
        }
        
        if (user) {
            return res.status(400).json({ message: 'Пользователь уже существует' });
        }
        
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            
            db.run('INSERT INTO users (username, password) VALUES (?, ?)',
                [username, hashedPassword],
                function(err) {
                    if (err) {
                        return res.status(500).json({ message: 'Ошибка создания пользователя' });
                    }
                    
                    req.session.userId = this.lastID;
                    req.session.username = username;
                    
                    res.status(201).json({
                        message: 'Пользователь создан',
                        userId: this.lastID,
                        username
                    });
                });
        } catch (error) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });
});

authRoutes.post('/login', validateBody({
    username: Validator.username,
    password: Validator.password
}), async (req, res) => {
    const { username, password } = req.sanitizedBody;
    
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка сервера' });
        }
        
        if (!user) {
            return res.status(401).json({ message: 'Неверные данные' });
        }
        
        try {
            const valid = await bcrypt.compare(password, user.password);
            
            if (!valid) {
                return res.status(401).json({ message: 'Неверные данные' });
            }
            
            req.session.userId = user.id;
            req.session.username = user.username;
            
            res.json({
                message: 'Успешная авторизация',
                userId: user.id,
                username: user.username
            });
        } catch (error) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });
});

authRoutes.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка при выходе' });
        }
        res.json({ message: 'Выход выполнен' });
    });
});

authRoutes.get('/check-auth', (req, res) => {
    if (req.session.userId) {
        res.json({
            isAuthenticated: true,
            userId: req.session.userId,
            username: req.session.username
        });
    } else {
        res.json({ isAuthenticated: false });
    }
});

app.use('/api', authRoutes);

const progressRoutes = express.Router();

progressRoutes.get('/dialogue-progress', requireAuth, (req, res) => {
    db.all('SELECT * FROM dialogue_progress WHERE user_id = ?', [req.session.userId], (err, rows) => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка получения прогресса' });
        }
        res.json({ progress: rows });
    });
});

progressRoutes.post('/dialogue-progress', requireAuth, (req, res) => {
    const { frequency, progress, completed, lastLine } = req.body;
    const userId = req.session.userId;
    
    const freqValid = Validator.frequency(frequency);
    if (!freqValid.valid) {
        return res.status(400).json({ message: freqValid.error });
    }
    
    db.get('SELECT * FROM dialogue_progress WHERE user_id = ? AND frequency = ?',
        [userId, frequency],
        (err, row) => {
            if (err) {
                return res.status(500).json({ message: 'Ошибка БД' });
            }
            
            if (row) {
                db.run('UPDATE dialogue_progress SET progress = ?, completed = ?, last_line = ? WHERE user_id = ? AND frequency = ?',
                    [progress, completed ? 1 : 0, lastLine, userId, frequency],
                    (err) => {
                        if (err) return res.status(500).json({ message: 'Ошибка обновления' });
                        res.json({ message: 'Прогресс обновлен' });
                    });
            } else {
                db.run('INSERT INTO dialogue_progress (user_id, frequency, progress, completed, last_line) VALUES (?, ?, ?, ?, ?)',
                    [userId, frequency, progress, completed ? 1 : 0, lastLine],
                    (err) => {
                        if (err) return res.status(500).json({ message: 'Ошибка сохранения' });
                        res.json({ message: 'Прогресс сохранен' });
                    });
            }
        });
});

progressRoutes.post('/user-choice', requireAuth, (req, res) => {
    const { frequency, choiceId, optionId, choiceText } = req.body;
    const userId = req.session.userId;
    
    // Сначала удаляем старые выборы для этой частоты и этого choiceId
    db.run('DELETE FROM user_choices WHERE user_id = ? AND frequency = ? AND choice_id = ?',
        [userId, frequency, choiceId],
        function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка удаления старого выбора' });
            
            // Теперь вставляем новый выбор
            db.run('INSERT INTO user_choices (user_id, frequency, choice_id, option_id, choice_text) VALUES (?, ?, ?, ?, ?)',
                [userId, frequency, choiceId, optionId, choiceText],
                function(err) {
                    if (err) return res.status(500).json({ message: 'Ошибка сохранения выбора' });
                    res.json({ message: 'Выбор сохранен', choiceId: this.lastID });
                });
        });
});

progressRoutes.get('/user-choices/:frequency', requireAuth, (req, res) => {
    db.all('SELECT * FROM user_choices WHERE user_id = ? AND frequency = ? ORDER BY created_at',
        [req.session.userId, req.params.frequency],
        (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения выборов' });
            res.json({ choices: rows });
        });
});

progressRoutes.delete('/user-choices/:frequency', requireAuth, (req, res) => {
    db.run('DELETE FROM user_choices WHERE user_id = ? AND frequency = ?',
        [req.session.userId, req.params.frequency],
        function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка удаления выборов' });
            res.json({ message: 'Выборы удалены' });
        });
});

progressRoutes.get('/available-frequencies', requireAuth, (req, res) => {
    db.all(`SELECT frequency, allowed_users FROM dialogues WHERE is_active != 0`, [], (err, rows) => {
        if (err) return res.status(500).json({ message: 'Ошибка получения частот' });
        
        const availableFrequencies = [];
        rows.forEach(row => {
            try {
                const allowedUsers = JSON.parse(row.allowed_users || '[-1]');
                if (allowedUsers.includes(-1) || allowedUsers.includes(req.session.userId)) {
                    availableFrequencies.push(row.frequency);
                }
            } catch (e) {
                availableFrequencies.push(row.frequency);
            }
        });
        
        res.json({ availableFrequencies });
    });
});

progressRoutes.get('/repeat-counts', requireAuth, (req, res) => {
    db.all('SELECT frequency, repeat_count FROM dialogue_repeats WHERE user_id = ?',
        [req.session.userId],
        (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            const counts = {};
            rows.forEach(r => counts[r.frequency] = r.repeat_count);
            res.json({ repeatCounts: counts });
        });
});

progressRoutes.post('/repeat-counts', requireAuth, (req, res) => {
    const { repeatCounts } = req.body;
    
    if (!repeatCounts || typeof repeatCounts !== 'object') {
        return res.status(400).json({ message: 'Неверный формат' });
    }
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        const stmt = db.prepare(`
            INSERT INTO dialogue_repeats (user_id, frequency, repeat_count, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, frequency) 
            DO UPDATE SET repeat_count = MAX(repeat_count, ?), updated_at = CURRENT_TIMESTAMP
        `);
        
        Object.entries(repeatCounts).forEach(([freq, count]) => {
            if (typeof count === 'number' && count >= 0) {
                stmt.run(req.session.userId, freq, count, count);
            }
        });
        
        stmt.finalize();
        
        db.run('COMMIT', (err) => {
            if (err) return res.status(500).json({ message: 'Ошибка сохранения' });
            res.json({ message: 'Сохранено' });
        });
    });
});

app.use('/api', progressRoutes);

const adminRoutes = express.Router();
const adminMiddleware = requireAdmin(db);

adminRoutes.get('/check', requireAuth, (req, res) => {
    db.get('SELECT is_admin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) return res.status(500).json({ message: 'Ошибка сервера' });
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });
        res.json({ isAdmin: user.is_admin === 1 });
    });
});

adminRoutes.get('/users', adminMiddleware, (req, res) => {
    db.all('SELECT id, username, created_at FROM users ORDER BY created_at DESC', (err, users) => {
        if (err) return res.status(500).json({ message: 'Ошибка получения списка' });
        res.json({ users });
    });
});

adminRoutes.post('/change-password', adminMiddleware, validateBody({
    userId: Validator.userId,
    newPassword: Validator.password
}), async (req, res) => {
    const { userId, newPassword } = req.sanitizedBody;
    
    try {
        const hashed = await bcrypt.hash(newPassword, 10);
        
        db.run('UPDATE users SET password = ? WHERE id = ?', [hashed, userId], function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка обновления' });
            res.json({ message: 'Пароль обновлен' });
        });
    } catch {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

adminRoutes.get('/choice-statistics', adminMiddleware, (req, res) => {
    const query = `
        SELECT uc.frequency, uc.choice_id, uc.choice_text, COUNT(*) as count, GROUP_CONCAT(u.username) as users
        FROM user_choices uc JOIN users u ON uc.user_id = u.id
        GROUP BY uc.frequency, uc.choice_id, uc.choice_text
        ORDER BY uc.frequency, uc.choice_id, count DESC
    `;
    
    db.all(query, (err, stats) => {
        if (err) return res.status(500).json({ message: 'Ошибка статистики' });
        const formatted = stats.map(s => ({
            ...s,
            option_id: s.choice_text?.split(':')[0]?.trim() || ''
        }));
        res.json({ statistics: formatted });
    });
});

adminRoutes.get('/choice-details/:frequency/:choiceId', adminMiddleware, (req, res) => {
    const query = `
        SELECT u.username, uc.choice_text, uc.created_at
        FROM user_choices uc JOIN users u ON uc.user_id = u.id
        WHERE uc.frequency = ? AND uc.choice_id = ?
        ORDER BY uc.created_at DESC
    `;
    
    db.all(query, [req.params.frequency, req.params.choiceId], (err, details) => {
        if (err) return res.status(500).json({ message: 'Ошибка деталей' });
        const formatted = details.map(d => ({
            ...d,
            option_id: d.choice_text?.split(':')[0]?.trim() || ''
        }));
        res.json({ details: formatted });
    });
});

adminRoutes.get('/user-progress', adminMiddleware, (req, res) => {
    const query = `
        SELECT u.username, dp.frequency, dp.progress, dp.completed, dp.last_line
        FROM dialogue_progress dp JOIN users u ON dp.user_id = u.id
        ORDER BY u.username, dp.frequency
    `;
    
    db.all(query, (err, progress) => {
        if (err) return res.status(500).json({ message: 'Ошибка прогресса' });
        res.json({ progress });
    });
});

adminRoutes.post('/set-dialogue-access', adminMiddleware, (req, res) => {
    const { frequency, userIds } = req.body;
    
    if (!frequency || !Array.isArray(userIds)) {
        return res.status(400).json({ message: 'Неверный формат' });
    }
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run('DELETE FROM dialogue_access WHERE frequency = ?', [frequency]);
        
        if (userIds.includes(-1)) {
            db.run('INSERT INTO dialogue_access (frequency, user_id) VALUES (?, -1)', [frequency]);
        } else {
            const stmt = db.prepare('INSERT INTO dialogue_access (frequency, user_id) VALUES (?, ?)');
            userIds.forEach(id => stmt.run(frequency, id));
            stmt.finalize();
        }
        
        db.run('COMMIT', (err) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            res.json({ message: 'Доступ установлен' });
        });
    });
});

app.use('/api/admin', adminRoutes);

// Роуты редактора диалогов
const dialogueEditorRoutes = require('./routes/dialogue-editor');
app.use('/api/editor', requireAuth, dialogueEditorRoutes(db, upload));

// API для получения диалогов клиентом
app.get('/api/dialogue/:frequency', (req, res) => {
    const { frequency } = req.params;
    
    db.get('SELECT * FROM dialogues WHERE frequency = ?', [frequency], (err, dialogue) => {
        if (err) return res.status(500).json({ message: 'Ошибка' });
        if (!dialogue) return res.status(404).json({ message: 'Диалог не найден' });
        
        const dialogueId = dialogue.id;
        
        db.all('SELECT * FROM characters WHERE dialogue_id = ? ORDER BY sort_order', [dialogueId], (err, characters) => {
            if (err) return res.status(500).json({ message: 'Ошибка' });
            
            db.all(`SELECT * FROM conversations WHERE dialogue_id = ? ORDER BY branch_id, sort_order`, 
                [dialogueId], (err, conversations) => {
                if (err) return res.status(500).json({ message: 'Ошибка' });
                
                const convIds = conversations.map(c => c.id);
                if (convIds.length === 0) {
                    res.json(formatDialogueForClient(dialogue, characters, [], []));
                    return;
                }
                
                db.all(`SELECT * FROM choice_options WHERE conversation_id IN (${convIds.map(() => '?').join(',')}) ORDER BY sort_order`, 
                    convIds, (err, choices) => {
                    if (err) return res.status(500).json({ message: 'Ошибка' });
                    res.json(formatDialogueForClient(dialogue, characters, conversations, choices));
                });
            });
        });
    });
});

function formatDialogueForClient(dialogue, characters, conversations, choices) {
    const result = {
        characters: characters.map(c => ({
            name: c.name,
            image: c.image,
            voice: c.voice,
            voiceMode: c.voice_mode || 'none',
            window: c.window
        })),
        allowedUsers: JSON.parse(dialogue.allowed_users || '[-1]'),
        isActive: dialogue.is_active !== 0,
        maxRepeats: dialogue.max_repeats !== undefined ? dialogue.max_repeats : 1,
        conversations: []
    };
    
    const branches = {};
    conversations.forEach(c => {
        if (!branches[c.branch_id]) branches[c.branch_id] = [];
        
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
            convObj.hasChoice = true;
            convObj.choice = {
                choiceId: convChoices[0].choice_id,
                options: convChoices.map(ch => ({
                    id: ch.option_id,
                    text: ch.option_text,
                    targetBranch: ch.target_branch
                }))
            };
        }
        
        branches[c.branch_id].push(convObj);
    });
    
    result.conversations = branches['main'] || [];
    
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

// Получить список всех частот
app.get('/api/frequencies', (req, res) => {
    db.all('SELECT frequency, title FROM dialogues WHERE is_active != 0 ORDER BY frequency', (err, dialogues) => {
        if (err) return res.status(500).json({ message: 'Ошибка' });
        res.json({ frequencies: dialogues.map(d => d.frequency) });
    });
});

app.post('/api/setup/first-admin', (req, res) => {
    const { setupKey } = req.body;
    
    if (setupKey !== config.SETUP_KEY) {
        return res.status(403).json({ message: 'Неверный ключ' });
    }
    
    db.get('SELECT id FROM users ORDER BY id LIMIT 1', (err, user) => {
        if (err) return res.status(500).json({ message: 'Ошибка сервера' });
        if (!user) return res.status(404).json({ message: 'Пользователи не найдены' });
        
        db.run('UPDATE users SET is_admin = 1 WHERE id = ?', [user.id], (err) => {
            if (err) return res.status(500).json({ message: 'Ошибка назначения' });
            res.json({ message: 'Администратор назначен', userId: user.id });
        });
    });
});

app.use((err, req, res, next) => {
    Logger.error('Unhandled error:', err);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
});

if (hasSSL) {
    const sslOptions = {
        key: fs.readFileSync(sslKeyPath),
        cert: fs.readFileSync(sslCertPath)
    };
    
    https.createServer(sslOptions, app).listen(config.PORT, () => {
        Logger.info(`HTTPS server started on port ${config.PORT}`);
        Logger.info(`CORS origins: ${config.CORS_ORIGINS.join(', ')}`);
    });
} else {
    http.createServer(app).listen(config.PORT, () => {
        Logger.info(`HTTP server started on port ${config.PORT}`);
        Logger.info(`CORS origins: ${config.CORS_ORIGINS.join(', ')}`);
        Logger.warn('Running in HTTP mode (no SSL certificates found)');
    });
}
