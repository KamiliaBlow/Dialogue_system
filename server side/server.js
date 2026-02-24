const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const https = require('https');
const fs = require('fs');
const path = require('path');

const config = require('./config');
const Logger = require('./utils/logger');
const { requireAuth, requireAdmin } = require('./middleware/auth');
const { Validator, validateBody } = require('./utils/validator');

config.validate();

const app = express();

// CORS middleware с расширенной конфигурацией
const corsOptions = {
    origin: function (origin, callback) {
        // Разрешаем запросы без origin (например, мобильные приложения, curl)
        if (!origin) return callback(null, true);
        
        // Проверяем, есть ли origin в списке разрешенных
        if (config.CORS_ORIGINS.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            Logger.warn(`CORS blocked origin: ${origin}`);
            callback(null, true); // Временно разрешаем все для отладки
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Обработка preflight запросов
app.options('*', cors(corsOptions));

const db = new sqlite3.Database(config.DB_PATH, (err) => {
    if (err) {
        Logger.error('Database connection error:', err.message);
    } else {
        Logger.info('Connected to SQLite database');
        initDatabase();
    }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // Отключаем secure для работы с HTTP в разработке
        maxAge: config.SESSION_MAX_AGE,
        sameSite: 'lax'
    }
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
        )`
    ];
    
    tables.forEach(sql => db.run(sql));
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
    const { frequency, choiceId, choiceText } = req.body;
    const userId = req.session.userId;
    
    db.run('INSERT INTO user_choices (user_id, frequency, choice_id, choice_text) VALUES (?, ?, ?, ?)',
        [userId, frequency, choiceId, choiceText],
        function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка сохранения выбора' });
            res.json({ message: 'Выбор сохранен', choiceId: this.lastID });
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

progressRoutes.get('/available-frequencies', requireAuth, (req, res) => {
    db.all(`SELECT DISTINCT frequency FROM dialogue_access WHERE user_id = ? OR user_id = -1`,
        [req.session.userId],
        (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения частот' });
            res.json({ availableFrequencies: rows.map(r => r.frequency) });
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

// Проверяем наличие SSL сертификатов
const sslKeyPath = path.join(__dirname, config.SSL_KEY_PATH);
const sslCertPath = path.join(__dirname, config.SSL_CERT_PATH);
const hasSSL = fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath);

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
    // Запуск HTTP сервера если нет SSL сертификатов
    const http = require('http');
    http.createServer(app).listen(config.PORT, () => {
        Logger.info(`HTTP server started on port ${config.PORT}`);
        Logger.info(`CORS origins: ${config.CORS_ORIGINS.join(', ')}`);
        Logger.warn('Running in HTTP mode (no SSL certificates found)');
    });
}
