const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
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
const { BASE_FRAME_WIDTH: PORTRAIT_BASE_WIDTH, portraitForClient } = require('./utils/portrait');

// Темы терминала. green = GMS, yellow = IPS-N, ktb = КТБ, horus = HORUS, ssc = Smith-Shimano Corpro,
// ha = Harrison Armory.
// Список один на весь сервер: миграция пилотов при запуске сбрасывает тему, которой в нём нет.
const VALID_THEMES = ['yellow', 'green', 'ktb', 'horus', 'ssc', 'ha'];
const VALID_THEMES_SQL = VALID_THEMES.map(t => `'${t}'`).join(', ');

// ====== Утилиты безопасности ======

// Проверка сигнатур (magic bytes) загружаемых файлов.
function detectMimeFromHeader(buf) {
    if (!buf || buf.length < 12) return null;
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47
        && buf[4] === 0x0D && buf[5] === 0x0A && buf[6] === 0x1A && buf[7] === 0x0A) return 'image/png';
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
    // Аудио
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'audio/mp3'; // ID3
    if (buf[0] === 0xFF && (buf[1] === 0xFB || buf[1] === 0xF3 || buf[1] === 0xF2)) return 'audio/mp3';
    if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'audio/ogg';
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) return 'audio/wav';
    return null;
}

// Нормализация и проверка пути внутри разрешённой директории (защита от path traversal).
function isPathSafe(relativePath, baseDir) {
    if (!relativePath || typeof relativePath !== 'string') return false;
    const cleaned = relativePath.replace(/^\/+/, '').replace(/\.\./g, '').trim();
    if (!cleaned) return false;
    const full = path.resolve(baseDir, cleaned);
    const base = path.resolve(baseDir);
    return full === base || full.startsWith(base + path.sep);
}

// Экземпляр-синглтон БД для использования в утилитах.
let dbInstance = null;

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

const imageFileFilter = (req, file, cb) => {
    const allowedExts = /\.(jpe?g|png|gif|webp)$/i;
    const allowedMimes = /^image\/(jpeg|png|gif|webp)$/i;
    if (!allowedExts.test(path.extname(file.originalname).toLowerCase()) || !allowedMimes.test(file.mimetype)) {
        return cb(new Error('Только изображения разрешены'));
    }
    cb(null, true);
};

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter
});

// Дополнительная проверка содержимого файла по сигнатурам (magic bytes).
// Использовать ПОСЛЕ multer: удаляет файл, если сигнатура не соответствует изображению.
function validateImageMagicBytes(file) {
    if (!file || !file.path) return false;
    try {
        const fd = fs.openSync(file.path, 'r');
        const buf = Buffer.alloc(16);
        const bytes = fs.readSync(fd, buf, 0, 16, 0);
        fs.closeSync(fd);
        const detected = detectMimeFromHeader(buf.slice(0, bytes));
        return detected ? /^image\//.test(detected) : false;
    } catch {
        return false;
    }
}

const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'assets/images/avatars');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        cb(null, 'avatar_' + uniqueSuffix + ext);
    }
});

const uploadAvatar = multer({
    storage: avatarStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFileFilter
});

// Загрузка музыки для плейлистов тем.
const musicStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'assets/sounds/music');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'music_' + uniqueSuffix + path.extname(file.originalname).toLowerCase());
    }
});

const uploadMusic = multer({
    storage: musicStorage,
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        // Расширение ИЛИ mime-тип: Windows/браузеры часто шлют application/octet-stream
        // или специфичные варианты (audio/x-pn-wav, audio/mp4 и т.п.).
        const allowedExts = /\.(wav|mp3|ogg|m4a|flac|opus|oga)$/i;
        const mimeOk = /^(audio|video)\//i.test(file.mimetype || '')
            || (file.mimetype || '') === 'application/octet-stream';
        if (allowedExts.test(path.extname(file.originalname).toLowerCase()) && mimeOk) {
            return cb(null, true);
        }
        const filterError = new Error('Только аудиофайлы (mp3, wav, ogg, m4a, flac, opus) разрешены');
        filterError.status = 400;
        cb(filterError);
    }
});

// Определение типа аудио по сигнатуре (magic bytes).
function detectAudioMime(buf) {
    if (!buf || buf.length < 12) return null;
    // MP3: ID3v2-тег или MPEG-аудиофрейм (0xFF FB/FA/F3/F2)
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'audio/mp3';
    if (buf[0] === 0xFF && (buf[1] === 0xFB || buf[1] === 0xFA || buf[1] === 0xF3 || buf[1] === 0xF2)) return 'audio/mp3';
    // OGG (vorbis/opus)
    if (buf[0] === 0x4F && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) return 'audio/ogg';
    // WAV/RIFF
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46
        && buf[8] === 0x57 && buf[9] === 0x41 && buf[10] === 0x56 && buf[11] === 0x45) return 'audio/wav';
    // FLAC
    if (buf[0] === 0x66 && buf[1] === 0x4C && buf[2] === 0x61 && buf[3] === 0x43) return 'audio/flac';
    // MP4/M4A: ....ftyp
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'audio/mp4';
    // WebM/Matroska: 0x1A45DFA3
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return 'audio/webm';
    return null;
}

// Проверка содержимого музыкального файла по сигнатурам (magic bytes).
function validateMusicMagicBytes(file) {
    if (!file || !file.path) return false;
    try {
        const fd = fs.openSync(file.path, 'r');
        const buf = Buffer.alloc(16);
        const bytes = fs.readSync(fd, buf, 0, 16, 0);
        fs.closeSync(fd);
        const detected = detectAudioMime(buf.slice(0, bytes));
        if (!detected) {
            Logger.warn(`validateMusicMagicBytes: неизвестная сигнатура файла ${file.originalname} (${bytes} байт)`);
        }
        return !!detected;
    } catch (e) {
        Logger.warn('validateMusicMagicBytes ошибка чтения:', e.message);
        return false;
    }
}

config.validate();

// Сертификат: полная цепочка (fullchain.pem или cert.pem + chain.pem), проверки при запуске
// и подмена на лету после продления — utils/ssl.js.
const ssl = require('./utils/ssl');
const sslKeyPath = path.join(__dirname, config.SSL_KEY_PATH);
const sslCertPath = path.join(__dirname, config.SSL_CERT_PATH);
const hasSSL = ssl.isAvailable(sslKeyPath, sslCertPath);

// Запрет фолбэка на HTTP в проде: SSL обязателен, если явно не разрешён ALLOW_HTTP=1.
if (!hasSSL && !config.ALLOW_HTTP) {
    console.error('\n========================================');
    console.error(' КРИТИЧЕСКАЯ ОШИБКА: SSL-сертификаты не найдены');
    console.error('========================================');
    console.error(' Сертификаты не найдены по путям:');
    console.error('   ' + sslKeyPath);
    console.error('   ' + sslCertPath);
    console.error('\n Запуск по HTTP в проде небезопасен (сессионные куки передаются открыто).');
    console.error(' Положите сертификаты в server side/ssl/ (privkey.pem и fullchain.pem из certbot)');
    console.error(' или установите ALLOW_HTTP=1 в .env ТОЛЬКО для локальной разработки.');
    console.error('========================================\n');
    process.exit(1);
}

const app = express();

// ====== Security headers (Helmet) ======
app.use(helmet({
    contentSecurityPolicy: {
        // CSP: разрешаем ресурсы только с разрешённых origin'ов и самих себя.
        // media-src/img-src также подключают data: (для озвучки/портретов, встроенных в разметку).
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", ...config.CORS_ORIGINS],
            mediaSrc: ["'self'", "data:", "blob:", ...config.CORS_ORIGINS],
            fontSrc: ["'self'", "data:"],
            connectSrc: ["'self'", ...config.CORS_ORIGINS],
            frameAncestors: ["'none'"],
            formAction: ["'self'"],
            baseUri: ["'self'"],
            objectSrc: ["'none'"]
        }
    },
    // HSTS только при HTTPS (helmet сам применит только к https-запросам).
    strictTransportSecurity: hasSSL ? {
        maxAge: 63072000,         // 2 года
        includeSubDomains: true,
        preload: true
    } : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' } // раздаём assets с other-origin
}));

const allowedHeadersList = ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin', 'Cache-Control', 'Expires', 'Pragma', 'If-Modified-Since', 'X-Request-Id'];

const corsOptions = {
    origin: function(origin, callback) {
        if (!origin) {
            return callback(null, false);
        }
        if (config.CORS_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowedHeaders: allowedHeadersList,
    exposedHeaders: ['Content-Length', 'X-Request-Id'],
    optionsSuccessStatus: 204
};

app.use(cors(corsOptions));

app.use((req, res, next) => {
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
dbInstance = db;

app.use(express.json({ limit: '1mb' }));
const assetsCorsMiddleware = (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.CORS_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    next();
};

app.use('/DIALOGUE_rework/assets', assetsCorsMiddleware, express.static(path.join(__dirname, 'assets')));
app.use('/assets', assetsCorsMiddleware, express.static(path.join(__dirname, 'assets')));
app.use(express.static(path.join(__dirname, 'public')));

// ====== Сессии ======
// SameSite=lax по умолчанию (защита от CSRF для запросов с других сайтов).
// secure=true при HTTPS. В режиме HTTP-разработки (ALLOW_HTTP=1) cookie не secure.
app.use(session({
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: hasSSL,
        maxAge: config.SESSION_MAX_AGE,
        sameSite: 'lax',
        httpOnly: true,
        path: '/'
    },
    name: 'sessionId'
}));
app.use(Logger.request);

// ====== Защита от CSRF через проверку Origin/Referer ======
// Для state-changing запросов (POST/PUT/PATCH/DELETE) с разрешённых origin'ов.
// Дополняет SameSite=lax и работает даже при cross-origin запросах из разрешённых доменов.
const csrfOriginCheck = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    const origin = req.headers.origin || req.headers.referer;
    if (!origin) {
        return res.status(403).json({ message: 'Запрос без Origin запрещён' });
    }
    let normalized = origin;
    try {
        const u = new URL(origin);
        normalized = u.origin;
    } catch {}
    if (!config.CORS_ORIGINS.includes(normalized)) {
        return res.status(403).json({ message: 'Недопустимый источник запроса' });
    }
    next();
};
app.use(csrfOriginCheck);

// ====== Rate limiting ======
// Общий лимит для всего API.
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,   // 15 минут
    max: 300,                   // 300 запросов на IP за окно
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Слишком много запросов, попробуйте позже' }
});
app.use('/api', apiLimiter);

// Строгий лимит для аутентификации (защита от brute-force / credential stuffing).
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,                    // 10 попыток на IP за 15 минут
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Слишком много попыток входа, попробуйте позже' }
});

function initDatabase() {
    db.serialize(() => {
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
        )`,
        `CREATE TABLE IF NOT EXISTS user_settings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER UNIQUE NOT NULL,
            auto_play_music INTEGER DEFAULT 1,
            theme TEXT DEFAULT 'yellow',
            skip_boot INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`,
        `CREATE TABLE IF NOT EXISTS pilot_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            slot_number INTEGER NOT NULL DEFAULT 1,
            callsign TEXT NOT NULL,
            full_name TEXT,
            mech_name TEXT NOT NULL,
            avatar_path TEXT,
            gender TEXT NOT NULL DEFAULT 'neutral',
            estate TEXT NOT NULL DEFAULT 'lancer',
            house_key TEXT NOT NULL DEFAULT '',
            house_custom TEXT NOT NULL DEFAULT '',
            house_color TEXT NOT NULL DEFAULT '',
            house_sigil TEXT NOT NULL DEFAULT '',
            house_standing TEXT NOT NULL DEFAULT 'member',
            theme TEXT NOT NULL DEFAULT '',
            is_nhp INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(user_id, slot_number)
        )`,
        `CREATE TABLE IF NOT EXISTS global_characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            image TEXT,
            portrait_scale REAL DEFAULT 1.0,
            portrait_x REAL DEFAULT 0,
            portrait_y REAL DEFAULT 0,
            portrait_mirror INTEGER DEFAULT 0,
            portrait_x_rel REAL,
            portrait_y_rel REAL,
            default_relation INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        `CREATE TABLE IF NOT EXISTS user_relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            global_character_id INTEGER NOT NULL,
            pilot_profile_id INTEGER NOT NULL DEFAULT 0,
            relation_value INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (global_character_id) REFERENCES global_characters(id) ON DELETE CASCADE,
            FOREIGN KEY (pilot_profile_id) REFERENCES pilot_profiles(id) ON DELETE CASCADE,
            UNIQUE(user_id, global_character_id, pilot_profile_id)
        )`,
        `CREATE TABLE IF NOT EXISTS music_playlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            theme TEXT NOT NULL DEFAULT 'yellow',
            title TEXT NOT NULL,
            file_path TEXT NOT NULL,
            volume INTEGER NOT NULL DEFAULT 100,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`,
        // Вариант реплики для сословия пилота. Основная реплика — для Лансера; вариант её заменяет,
        // когда сословие совпадает: cavalier — Кавалер в Доме, exile — Кавалер-изгнанник.
        // Нет варианта — звучит основная реплика (client side/scripts/pilot-tokens.js).
        `CREATE TABLE IF NOT EXISTS conversation_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL,
            audience TEXT NOT NULL CHECK (audience IN ('cavalier', 'exile')),
            text TEXT NOT NULL,
            voiceline TEXT NOT NULL DEFAULT '',
            fake_name TEXT NOT NULL DEFAULT '',
            custom_image TEXT NOT NULL DEFAULT '',
            typing_speed REAL NOT NULL DEFAULT 0,
            voice_offset INTEGER NOT NULL DEFAULT 0,
            typing_profile TEXT NOT NULL DEFAULT '',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
            UNIQUE(conversation_id, audience)
        )`,
        // Перемычки связей в дереве студии: точки, через которые идёт линия связи.
        // edge_key — seq:<из>:<в> (реплики подряд) или choice:<id ответа>; points — JSON [{dx, dy}],
        // смещения от нижней середины исходной реплики (так перемычки едут вместе с ней).
        `CREATE TABLE IF NOT EXISTS dialogue_edge_points (
            dialogue_id INTEGER NOT NULL,
            edge_key TEXT NOT NULL,
            points TEXT NOT NULL DEFAULT '[]',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (dialogue_id, edge_key)
        )`,
        // Реплику удаляют из разных мест (реплика, ветка, диалог) — варианты уходят вместе с ней
        // независимо от PRAGMA foreign_keys.
        `CREATE TRIGGER IF NOT EXISTS conversation_variants_cleanup
            AFTER DELETE ON conversations
            BEGIN
                DELETE FROM conversation_variants WHERE conversation_id = OLD.id;
            END`
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

    // Скорость печати реплики. Миграцию убрали в 2.8.1, а роуты редактора колонку пишут:
    // на новой базе без неё не создавалась ни одна реплика (500).
    db.run(`ALTER TABLE conversations ADD COLUMN typing_speed REAL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (typing_speed):', err.message);
        }
    });

    // Тишина в начале озвучки, мс: терминал начинает печать вместе с голосом
    // (ROADMAP, задача 9, шаг B; считает кнопка «Авто» в студии).
    // Скорость по фразам (шаг C): JSON [[внутри, после], …] на каждую фразу текста; пусто — одна скорость typing_speed.
    ['conversations', 'conversation_variants'].forEach(table => {
        db.run(`ALTER TABLE ${table} ADD COLUMN voice_offset INTEGER NOT NULL DEFAULT 0`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                Logger.error(`Migration error (${table}.voice_offset):`, err.message);
            }
        });
        db.run(`ALTER TABLE ${table} ADD COLUMN typing_profile TEXT NOT NULL DEFAULT ''`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                Logger.error(`Migration error (${table}.typing_profile):`, err.message);
            }
        });
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
    db.run(`ALTER TABLE pilot_profiles ADD COLUMN is_active INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (is_active):', err.message);
        }
    });

    db.run(`ALTER TABLE pilot_profiles ADD COLUMN gender TEXT NOT NULL DEFAULT 'neutral'`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (gender):', err.message);
        }
    });

    db.run(`ALTER TABLE pilot_profiles ADD COLUMN estate TEXT NOT NULL DEFAULT 'lancer'`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (estate):', err.message);
        }
    });

    db.run(`ALTER TABLE pilot_profiles ADD COLUMN is_nhp INTEGER NOT NULL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (is_nhp):', err.message);
        }
    });

    // Дом Кавалера КТБ: готовый Великий Дом или собственный, положение — в Доме или изгнанник.
    [
        ['house_key', "TEXT NOT NULL DEFAULT ''"],
        ['house_custom', "TEXT NOT NULL DEFAULT ''"],
        ['house_color', "TEXT NOT NULL DEFAULT ''"],
        ['house_sigil', "TEXT NOT NULL DEFAULT ''"],
        ['house_standing', "TEXT NOT NULL DEFAULT 'member'"]
    ].forEach(([column, definition]) => {
        db.run(`ALTER TABLE pilot_profiles ADD COLUMN ${column} ${definition}`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                Logger.error(`Migration error (${column}):`, err.message);
            }
        });
    });

    // Тема терминала закреплена за пилотом (green = GMS, yellow = IPS-N, ktb = КТБ).
    // Пилотам без темы проставляется тема владельца из user_settings — у старых аккаунтов ничего не меняется.
    db.run(`ALTER TABLE pilot_profiles ADD COLUMN theme TEXT NOT NULL DEFAULT ''`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (pilot theme):', err.message);
        }
    });
    db.run(`UPDATE pilot_profiles
            SET theme = COALESCE((SELECT us.theme FROM user_settings us
                                  WHERE us.user_id = pilot_profiles.user_id AND us.theme IN (${VALID_THEMES_SQL})), 'yellow')
            WHERE theme IS NULL OR theme NOT IN (${VALID_THEMES_SQL})`, (err) => {
        if (err) Logger.error('Migration error (pilot theme backfill):', err.message);
    });

    // Масштаб интерфейса по классам экрана (phone / tablet / desktop / large): новое устройство
    // берёт значение своего класса, своё значение на устройстве главнее (client side/scripts/ui-scale.js).
    db.run(`ALTER TABLE user_settings ADD COLUMN ui_scales TEXT NOT NULL DEFAULT '{}'`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (ui_scales):', err.message);
        }
    });

    db.run(`ALTER TABLE user_settings ADD COLUMN skip_boot INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (skip_boot):', err.message);
        }
    });

    db.run(`ALTER TABLE characters ADD COLUMN portrait_scale REAL DEFAULT 1.0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (portrait_scale):', err.message);
        }
    });

    db.run(`ALTER TABLE characters ADD COLUMN portrait_x REAL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (portrait_x):', err.message);
        }
    });

    db.run(`ALTER TABLE characters ADD COLUMN portrait_y REAL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (portrait_y):', err.message);
        }
    });

    db.run(`ALTER TABLE characters ADD COLUMN portrait_mirror INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (portrait_mirror):', err.message);
        }
    });

    // Смещение портрета в долях ширины рамки (utils/portrait.js): одинаково на любом экране.
    // Старые пиксели пересчитываются от базовой рамки 258 px — на 1920×1080 вид не меняется.
    ['global_characters', 'characters'].forEach(table => {
        ['portrait_x_rel', 'portrait_y_rel'].forEach(column => {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${column} REAL`, (err) => {
                if (err && !err.message.includes('duplicate column')) {
                    Logger.error(`Migration error (${table}.${column}):`, err.message);
                }
            });
        });
        db.run(`UPDATE ${table}
                SET portrait_x_rel = COALESCE(portrait_x, 0) / ${PORTRAIT_BASE_WIDTH}.0,
                    portrait_y_rel = COALESCE(portrait_y, 0) / ${PORTRAIT_BASE_WIDTH}.0
                WHERE portrait_x_rel IS NULL OR portrait_y_rel IS NULL`, (err) => {
            if (err) Logger.error(`Migration error (${table} portrait rel):`, err.message);
        });
    });

    db.run(`ALTER TABLE choice_options ADD COLUMN relation_npc_id INTEGER DEFAULT NULL`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (relation_npc_id):', err.message);
        }
    });

    db.run(`ALTER TABLE choice_options ADD COLUMN relation_require_min INTEGER DEFAULT -100`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (relation_require_min):', err.message);
        }
    });

    db.run(`ALTER TABLE choice_options ADD COLUMN relation_require_max INTEGER DEFAULT 100`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (relation_require_max):', err.message);
        }
    });

    db.run(`ALTER TABLE choice_options ADD COLUMN relation_effect INTEGER DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (relation_effect):', err.message);
        }
    });

    db.run(`ALTER TABLE characters ADD COLUMN global_character_id INTEGER DEFAULT NULL`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (global_character_id):', err.message);
        }
    });

    db.run(`ALTER TABLE choice_options ADD COLUMN relation_global_char_id INTEGER DEFAULT NULL`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (relation_global_char_id):', err.message);
        }
    });

    // Текст варианта ответа для Кавалера в Доме и для изгнанника; пусто — основной текст.
    ['option_text_cavalier', 'option_text_exile'].forEach(column => {
        db.run(`ALTER TABLE choice_options ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`, (err) => {
            if (err && !err.message.includes('duplicate column')) {
                Logger.error(`Migration error (${column}):`, err.message);
            }
        });
    });

    migrateConversationVariants();

    db.all("PRAGMA table_info(user_relations)", [], (err, cols) => {
        if (!err && cols && cols.length > 0) {
            const hasGlobalCharId = cols.some(c => c.name === 'global_character_id');
            const hasNpcCharId = cols.some(c => c.name === 'npc_character_id');
            if (hasNpcCharId && !hasGlobalCharId) {
                Logger.info('Migrating user_relations from npc_character_id to global_character_id...');
                db.run('DROP TABLE IF EXISTS user_relations', (err) => {
                    if (err) {
                        Logger.error('Failed to drop old user_relations:', err.message);
                    } else {
                        db.run(`CREATE TABLE IF NOT EXISTS user_relations (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            user_id INTEGER NOT NULL,
                            global_character_id INTEGER NOT NULL,
                            pilot_profile_id INTEGER NOT NULL DEFAULT 0,
                            relation_value INTEGER DEFAULT 0,
                            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                            FOREIGN KEY (global_character_id) REFERENCES global_characters(id) ON DELETE CASCADE,
                            FOREIGN KEY (pilot_profile_id) REFERENCES pilot_profiles(id) ON DELETE CASCADE,
                            UNIQUE(user_id, global_character_id, pilot_profile_id)
                        )`, (err) => {
                            if (err) Logger.error('Failed to recreate user_relations:', err.message);
                            else Logger.info('user_relations migrated successfully');
                        });
                    }
                });
            }
        }
    });

    // ====== Миграция user_relations: репутация ведётся отдельно для каждого пилота ======
    // Добавляем pilot_profile_id (0 = общая репутация, до введения пилотов) и заменяем
    // старый UNIQUE(user_id, global_character_id) на тройной, разрешающий строки по пилотам.
    db.run(`ALTER TABLE user_relations ADD COLUMN pilot_profile_id INTEGER NOT NULL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
            Logger.error('Migration error (user_relations.pilot_profile_id):', err.message);
            return;
        }

        db.all("PRAGMA index_list(user_relations)", [], (err, indexes) => {
            if (err) {
                Logger.error('Migration error (index_list):', err.message);
                return;
            }
            const uniqueIndexes = (indexes || []).filter(ix => ix.origin === 'u');
            const checkUniqueIndexes = (i, needRecreate) => {
                if (i >= uniqueIndexes.length) {
                    if (needRecreate) recreateUserRelationsTable();
                    return;
                }
                db.all(`PRAGMA index_info("${uniqueIndexes[i].name}")`, [], (err, cols) => {
                    if (err) {
                        checkUniqueIndexes(i + 1, true);
                        return;
                    }
                    const hasPilotColumn = (cols || []).some(c => c.name === 'pilot_profile_id');
                    checkUniqueIndexes(i + 1, needRecreate || !hasPilotColumn);
                });
            };
            checkUniqueIndexes(0, false);
        });
    });
    });
}

// Пересоздание user_relations с UNIQUE(user_id, global_character_id, pilot_profile_id).
// Старые строки сохраняются с pilot_profile_id = 0 (общая репутация).
function recreateUserRelationsTable() {
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        db.run(`CREATE TABLE IF NOT EXISTS user_relations_v2 (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            global_character_id INTEGER NOT NULL,
            pilot_profile_id INTEGER NOT NULL DEFAULT 0,
            relation_value INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (global_character_id) REFERENCES global_characters(id) ON DELETE CASCADE,
            FOREIGN KEY (pilot_profile_id) REFERENCES pilot_profiles(id) ON DELETE CASCADE,
            UNIQUE(user_id, global_character_id, pilot_profile_id)
        )`);
        db.run(`INSERT OR IGNORE INTO user_relations_v2 (id, user_id, global_character_id, pilot_profile_id, relation_value, updated_at)
                SELECT id, user_id, global_character_id, pilot_profile_id, relation_value, updated_at FROM user_relations`);
        db.run('DROP TABLE user_relations');
        db.run('ALTER TABLE user_relations_v2 RENAME TO user_relations');
        db.run('COMMIT', (err) => {
            if (err) {
                db.run('ROLLBACK');
                Logger.error('Migration failed (user_relations recreate):', err.message);
            } else {
                Logger.info('user_relations: репутация переведена на раздельный учёт по пилотам');
            }
        });
    });
}


const authRoutes = express.Router();

authRoutes.post('/register', authLimiter, validateBody({
    username: Validator.username,
    password: Validator.password
}), async (req, res) => {
    const { username, password } = req.sanitizedBody;
    const normalizedUsername = username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();
    
    db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [normalizedUsername], async (err, user) => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка сервера' });
        }
        
        if (user) {
            return res.status(400).json({ message: 'Пользователь уже существует' });
        }
        
        try {
            const hashedPassword = await bcrypt.hash(password, 10);
            
            db.run('INSERT INTO users (username, password) VALUES (?, ?)',
                [normalizedUsername, hashedPassword],
                function(err) {
                    if (err) {
                        return res.status(500).json({ message: 'Ошибка создания пользователя' });
                    }
                    
                    const userId = this.lastID;

                    db.run('INSERT INTO user_settings (user_id, auto_play_music) VALUES (?, 1)',
                        [userId],
                        function(err) {
                            if (err) {
                                Logger.error('Error creating user settings:', err.message);
                            }
                        });

                    // Пересоздание сессии после регистрации (защита от session fixation).
                    req.session.regenerate((err) => {
                        if (err) {
                            Logger.error('Session regenerate error (register):', err.message);
                            return res.status(500).json({ message: 'Ошибка сервера' });
                        }
                        req.session.userId = userId;
                        req.session.username = normalizedUsername;

                        res.status(201).json({
                            message: 'Пользователь создан',
                            userId: userId,
                            username: normalizedUsername
                        });
                    });
                });
        } catch (error) {
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });
});

authRoutes.post('/login', authLimiter, validateBody({
    username: Validator.username,
    password: Validator.password
}), async (req, res) => {
    const { username, password } = req.sanitizedBody;

    db.get('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ message: 'Ошибка сервера' });
        }

        // Валидный фиктивный bcrypt-хеш для несуществующих пользователей — выравнивает
        // время ответа и мешает timing-атаке на перечисление логинов.
        const dummyHash = '$2a$10$FYc8IWIJbWCZ9ZRS1429eO7pLTcTRe90ZxQrRYgJWqmLy9EfeM8sC';
        const hashToCheck = user ? user.password : dummyHash;

        try {
            const valid = await bcrypt.compare(password, hashToCheck);

            if (!user || !valid) {
                return res.status(401).json({ message: 'Неверные данные' });
            }

            // Пересоздание сессии после успешного входа (защита от session fixation).
            req.session.regenerate((err) => {
                if (err) {
                    Logger.error('Session regenerate error (login):', err.message);
                    return res.status(500).json({ message: 'Ошибка сервера' });
                }
                req.session.userId = user.id;
                req.session.username = user.username;

                res.json({
                    message: 'Успешная авторизация',
                    userId: user.id,
                    username: user.username
                });
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

// Совпадает с client side/scripts/ktb-houses.js.
const KTB_HOUSE_KEYS = ['order', 'glass', 'smoke', 'stone', 'sand', 'water', 'dust', 'moments', 'remembrance', 'promise'];
// Знак своего Дома: id из набора client side/scripts/ktb-houses.js (набор пополняется,
// поэтому проверяется формат id); незнакомый id клиент рисует короной.
const KTB_SIGIL_ID = /^[a-z][a-z0-9-]{0,23}$/;

// Тема по умолчанию для нового пилота — последняя выбранная пользователем (user_settings.theme).
function getUserTheme(userId, callback) {
    db.get('SELECT theme FROM user_settings WHERE user_id = ?', [userId], (err, row) => {
        callback(!err && row && VALID_THEMES.includes(row.theme) ? row.theme : 'yellow');
    });
}

const pilotRoutes = express.Router();

pilotRoutes.get('/pilot-profiles', requireAuth, (req, res) => {
    db.all('SELECT id, slot_number, callsign, full_name, mech_name, avatar_path, gender, estate, house_key, house_custom, house_color, house_sigil, house_standing, theme, is_nhp, is_active, created_at, updated_at FROM pilot_profiles WHERE user_id = ? ORDER BY slot_number',
        [req.session.userId], 
        (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения профилей' });
            
            const profiles = [];
            for (let i = 1; i <= 3; i++) {
                const existing = rows.find(r => r.slot_number === i);
                if (existing) {
                    profiles.push(existing);
                } else {
                    profiles.push({
                        slot_number: i,
                        callsign: '',
                        full_name: '',
                        mech_name: '',
                        avatar_path: null,
                        gender: 'neutral',
                        estate: 'lancer',
                        house_key: '',
                        house_custom: '',
                        house_color: '',
                        house_sigil: '',
                        house_standing: 'member',
                        theme: '',
                        is_nhp: 0,
                        is_active: 0
                    });
                }
            }
            res.json({ profiles });
        });
});

pilotRoutes.get('/pilot-profiles/active', requireAuth, (req, res) => {
    db.get('SELECT * FROM pilot_profiles WHERE user_id = ? AND is_active = 1', 
        [req.session.userId], 
        (err, row) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения активного профиля' });
            res.json({ profile: row || null });
        });
});

// Проверка и нормализация полей пилота — общая для досье игрока и админ-панели.
// Возвращает { error } или { pilot } (тема — null, если не передана).
function normalizePilotFields(body) {
    const { callsign, full_name, mech_name, gender, estate, is_nhp,
        house_key, house_custom, house_color, house_sigil, house_standing, theme } = body || {};
    const normalizedGender = gender === undefined ? 'neutral' : gender;
    const normalizedEstate = estate === undefined ? 'lancer' : estate;

    if (typeof callsign !== 'string' || callsign.trim() === '') return { error: 'Позывной обязателен' };
    if (typeof mech_name !== 'string' || mech_name.trim() === '') return { error: 'Название меха обязательно' };
    if (full_name !== undefined && full_name !== null && typeof full_name !== 'string') return { error: 'Некорректное полное имя' };
    if (!['female', 'male', 'neutral'].includes(normalizedGender)) return { error: 'Неизвестная форма обращения' };
    if (!['cavalier', 'lancer'].includes(normalizedEstate)) return { error: 'Неизвестный статус персонажа' };
    if (is_nhp !== undefined && ![0, 1, '0', '1', true, false].includes(is_nhp)) return { error: 'Некорректный признак НЧЛ' };

    // Дом хранится только у Кавалера; у Лансера поля обнуляются.
    const isCavalier = normalizedEstate === 'cavalier';
    const houseKey = isCavalier && typeof house_key === 'string' ? house_key : '';
    if (houseKey && !KTB_HOUSE_KEYS.includes(houseKey) && houseKey !== 'custom') return { error: 'Неизвестный Дом' };
    const houseCustom = houseKey === 'custom' && typeof house_custom === 'string'
        ? house_custom.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    if (houseKey === 'custom' && !houseCustom) return { error: 'Укажите название своего Дома' };

    // Тема пилота: не передана — у существующего пилота сохраняется, новому достаётся тема пользователя.
    if (theme !== undefined && theme !== null && theme !== '' && !VALID_THEMES.includes(theme)) return { error: 'Неизвестная тема' };

    return {
        pilot: {
            callsign: callsign.trim().slice(0, 60),
            full_name: typeof full_name === 'string' ? full_name.trim().slice(0, 160) : '',
            mech_name: mech_name.trim().slice(0, 60),
            gender: normalizedGender,
            estate: normalizedEstate,
            is_nhp: [1, '1', true].includes(is_nhp) ? 1 : 0,
            house_key: houseKey,
            house_custom: houseCustom,
            house_color: houseKey === 'custom' && typeof house_color === 'string' && /^#[0-9a-f]{6}$/i.test(house_color)
                ? house_color.toLowerCase() : '',
            house_sigil: houseKey === 'custom' && typeof house_sigil === 'string' && KTB_SIGIL_ID.test(house_sigil) ? house_sigil : '',
            house_standing: isCavalier && house_standing === 'exile' ? 'exile' : 'member',
            theme: VALID_THEMES.includes(theme) ? theme : null
        }
    };
}

pilotRoutes.post('/pilot-profiles', requireAuth, (req, res) => {
    const { slot_number, avatar_path } = req.body;
    const userId = req.session.userId;

    if (!slot_number || slot_number < 1 || slot_number > 3) {
        return res.status(400).json({ message: 'Номер слота должен быть от 1 до 3' });
    }
    const checked = normalizePilotFields(req.body);
    if (checked.error) return res.status(400).json({ message: checked.error });
    const p = checked.pilot;
    const requestedTheme = p.theme;

    // avatar_path должен указывать только на директорию аватаров (защита от path traversal).
    let safeAvatarPath = null;
    if (avatar_path && typeof avatar_path === 'string') {
        const avatarsDir = path.join(__dirname, 'assets/images/avatars');
        // Приводим к виду относительно директории аватаров.
        const rel = avatar_path.replace(/^\/assets\/images\/avatars\//, '').replace(/^\/+/, '');
        if (isPathSafe(rel, avatarsDir)) {
            safeAvatarPath = `/assets/images/avatars/${path.basename(rel)}`;
        } else {
            return res.status(400).json({ message: 'Недопустимый путь аватара' });
        }
    }

    getUserTheme(userId, defaultTheme => {
    db.run(`INSERT INTO pilot_profiles (user_id, slot_number, callsign, full_name, mech_name, avatar_path, gender, estate,
                house_key, house_custom, house_color, house_sigil, house_standing, theme, is_nhp, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, slot_number) DO UPDATE SET
                callsign = excluded.callsign,
                full_name = excluded.full_name,
                mech_name = excluded.mech_name,
                avatar_path = excluded.avatar_path,
                gender = excluded.gender,
                estate = excluded.estate,
                house_key = excluded.house_key,
                house_custom = excluded.house_custom,
                house_color = excluded.house_color,
                house_sigil = excluded.house_sigil,
                house_standing = excluded.house_standing,
                theme = CASE WHEN ? THEN excluded.theme ELSE pilot_profiles.theme END,
                is_nhp = excluded.is_nhp,
                updated_at = CURRENT_TIMESTAMP`,
        [userId, slot_number, p.callsign, p.full_name, p.mech_name, safeAvatarPath, p.gender, p.estate,
            p.house_key, p.house_custom, p.house_color, p.house_sigil, p.house_standing,
            requestedTheme || defaultTheme, p.is_nhp, requestedTheme ? 1 : 0],
        function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка сохранения профиля' });

            db.get('SELECT * FROM pilot_profiles WHERE user_id = ? AND slot_number = ?', [userId, slot_number], (err, profile) => {
                if (err) return res.status(500).json({ message: 'Ошибка получения профиля' });

                // Если у пользователя ещё нет активного пилота — назначаем сохранённый.
                db.get('SELECT id FROM pilot_profiles WHERE user_id = ? AND is_active = 1', [userId], (err, active) => {
                    if (err) return res.status(500).json({ message: 'Ошибка проверки активного профиля' });

                    if (active) {
                        return res.json({ message: 'Профиль сохранен', profile, activated: false });
                    }

                    db.run('UPDATE pilot_profiles SET is_active = 1 WHERE user_id = ? AND slot_number = ?', [userId, slot_number], (err) => {
                        if (err) return res.status(500).json({ message: 'Ошибка назначения активного профиля' });
                        profile.is_active = 1;
                        res.json({ message: 'Профиль сохранен и назначен активным', profile, activated: true });
                    });
                });
            });
        });
    });
});

pilotRoutes.delete('/pilot-profiles/:slot_number', requireAuth, (req, res) => {
    const { slot_number } = req.params;
    const userId = req.session.userId;
    
    if (!slot_number || slot_number < 1 || slot_number > 3) {
        return res.status(400).json({ message: 'Номер слота должен быть от 1 до 3' });
    }
    
    db.run('DELETE FROM pilot_profiles WHERE user_id = ? AND slot_number = ?', [userId, slot_number], function(err) {
        if (err) return res.status(500).json({ message: 'Ошибка удаления профиля' });
        res.json({ message: 'Профиль удален' });
    });
});

pilotRoutes.post('/pilot-profiles/set-active/:slot_number', requireAuth, (req, res) => {
    const { slot_number } = req.params;
    const userId = req.session.userId;
    
    if (!slot_number || slot_number < 1 || slot_number > 3) {
        return res.status(400).json({ message: 'Номер слота должен быть от 1 до 3' });
    }
    
    db.get('SELECT * FROM pilot_profiles WHERE user_id = ? AND slot_number = ?', [userId, slot_number], (err, profile) => {
        if (err) return res.status(500).json({ message: 'Ошибка проверки профиля' });
        if (!profile) return res.status(404).json({ message: 'Профиль не найден' });
        
        db.serialize(() => {
            db.run('UPDATE pilot_profiles SET is_active = 0 WHERE user_id = ?', [userId]);
            db.run('UPDATE pilot_profiles SET is_active = 1 WHERE user_id = ? AND slot_number = ?', [userId, slot_number], (err) => {
                if (err) return res.status(500).json({ message: 'Ошибка установки активного профиля' });
                res.json({ message: 'Профиль установлен как активный', profile });
            });
        });
    });
});

pilotRoutes.post('/pilot-profiles/upload-avatar/:slot_number', requireAuth, uploadAvatar.single('avatar'), (req, res) => {
    const { slot_number } = req.params;
    const userId = req.session.userId;

    const slotNum = parseInt(slot_number, 10);
    if (!Number.isInteger(slotNum) || slotNum < 1 || slotNum > 3) {
        return res.status(400).json({ message: 'Номер слота должен быть от 1 до 3' });
    }

    if (!req.file) {
        return res.status(400).json({ message: 'Файл не загружен' });
    }

    // Проверка содержимого файла по сигнатурам (защита от замаскированных файлов).
    if (!validateImageMagicBytes(req.file)) {
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ message: 'Файл не является корректным изображением' });
    }

    const avatarPath = `/assets/images/avatars/${req.file.filename}`;

    db.run('UPDATE pilot_profiles SET avatar_path = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND slot_number = ?',
        [avatarPath, userId, slot_number],
        function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка сохранения аватара' });
            res.json({ message: 'Аватар загружен', avatar_path: avatarPath });
        });
});

app.use('/api', pilotRoutes);

// Плейлист темы для авторизованных пользователей (воспроизведение в терминале).
app.get('/api/music-playlist/:theme', requireAuth, (req, res) => {
    const theme = VALID_THEMES.includes(req.params.theme) ? req.params.theme : 'yellow';
    db.all('SELECT id, title, file_path, volume, sort_order FROM music_playlist WHERE theme = ? ORDER BY sort_order, id',
        [theme], (err, rows) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения плейлиста' });
            res.json({ tracks: rows });
        });
});

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

    const progressValid = Validator.progress(progress);
    if (!progressValid.valid) {
        return res.status(400).json({ message: progressValid.error });
    }

    const lastLineValid = Validator.progress(lastLine);
    if (!lastLineValid.valid) {
        return res.status(400).json({ message: 'Некорректное значение lastLine' });
    }

    const safeProgress = progressValid.value;
    const safeLastLine = lastLineValid.value;

    db.get('SELECT * FROM dialogue_progress WHERE user_id = ? AND frequency = ?',
        [userId, frequency],
        (err, row) => {
            if (err) {
                return res.status(500).json({ message: 'Ошибка БД' });
            }

            if (row) {
                db.run('UPDATE dialogue_progress SET progress = ?, completed = ?, last_line = ? WHERE user_id = ? AND frequency = ?',
                    [safeProgress, completed ? 1 : 0, safeLastLine, userId, frequency],
                    (err) => {
                        if (err) return res.status(500).json({ message: 'Ошибка обновления' });
                        res.json({ message: 'Прогресс обновлен' });
                    });
            } else {
                db.run('INSERT INTO dialogue_progress (user_id, frequency, progress, completed, last_line) VALUES (?, ?, ?, ?, ?)',
                    [userId, frequency, safeProgress, completed ? 1 : 0, safeLastLine],
                    (err) => {
                        if (err) return res.status(500).json({ message: 'Ошибка сохранения' });
                        res.json({ message: 'Прогресс сохранен' });
                    });
            }
        });
});

progressRoutes.post('/user-choice', requireAuth, (req, res) => {
    const { frequency, choiceId, optionId, choiceText, relationNpcName, relationEffect } = req.body;
    const userId = req.session.userId;
    
    const applyRelation = (callback) => {
        if (!relationNpcName || !relationEffect || relationEffect === 0) {
            return callback();
        }
        
        db.get('SELECT id FROM global_characters WHERE name = ?', [relationNpcName], (err, gc) => {
            if (err || !gc) return callback();

            // Изменение репутации записывается на счёт активного пилота (0 — общая, если пилота нет).
            db.run(`INSERT INTO user_relations (user_id, global_character_id, pilot_profile_id, relation_value)
                    VALUES (?, ?, COALESCE((SELECT id FROM pilot_profiles WHERE user_id = ? AND is_active = 1), 0), ?)
                    ON CONFLICT(user_id, global_character_id, pilot_profile_id)
                    DO UPDATE SET relation_value = MAX(-100, MIN(100, relation_value + ?)), updated_at = CURRENT_TIMESTAMP`,
                [userId, gc.id, userId, relationEffect, relationEffect],
                (err) => {
                    if (err) Logger.error('Error updating relation:', err.message);
                    callback();
                });
        });
    };
    
    db.run('DELETE FROM user_choices WHERE user_id = ? AND frequency = ? AND choice_id = ?',
        [userId, frequency, choiceId],
        function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка удаления старого выбора' });
            
            db.run('INSERT INTO user_choices (user_id, frequency, choice_id, option_id, choice_text) VALUES (?, ?, ?, ?, ?)',
                [userId, frequency, choiceId, optionId, choiceText],
                function(err) {
                    if (err) return res.status(500).json({ message: 'Ошибка сохранения выбора' });
                    
                    const lastId = this.lastID;
                    applyRelation(() => {
                        res.json({ message: 'Выбор сохранен', choiceId: lastId });
                    });
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

    if (!repeatCounts || typeof repeatCounts !== 'object' || Array.isArray(repeatCounts)) {
        return res.status(400).json({ message: 'Неверный формат' });
    }

    const entries = Object.entries(repeatCounts);
    const MAX_KEYS = 100;
    if (entries.length > MAX_KEYS) {
        return res.status(400).json({ message: `Слишком много записей (максимум ${MAX_KEYS})` });
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        const stmt = db.prepare(`
            INSERT INTO dialogue_repeats (user_id, frequency, repeat_count, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(user_id, frequency)
            DO UPDATE SET repeat_count = MAX(repeat_count, ?), updated_at = CURRENT_TIMESTAMP
        `);

        entries.forEach(([freq, count]) => {
            // frequency ограничиваем по длине, count — положительное число в разумном диапазоне.
            if (typeof freq === 'string' && freq.length > 0 && freq.length <= 20 &&
                typeof count === 'number' && Number.isFinite(count) && count >= 0 && count <= 1000) {
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

// Переименование: меняется логин. Правила и регистр — как при регистрации (Validator.username,
// первая буква заглавная), имя уникально без учёта регистра.
adminRoutes.post('/rename-user', adminMiddleware, validateBody({
    userId: Validator.userId,
    username: Validator.username
}), (req, res) => {
    const { userId, username } = req.sanitizedBody;
    const normalized = username.charAt(0).toUpperCase() + username.slice(1).toLowerCase();

    db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?', [normalized, userId], (err, taken) => {
        if (err) return res.status(500).json({ message: 'Ошибка сервера' });
        if (taken) return res.status(400).json({ message: 'Пользователь с таким именем уже существует' });
        db.run('UPDATE users SET username = ? WHERE id = ?', [normalized, userId], function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка переименования' });
            if (this.changes === 0) return res.status(404).json({ message: 'Пользователь не найден' });
            // Своё имя админ видит сразу; у переименованного игрока — после следующего входа.
            if (Number(userId) === Number(req.session.userId)) req.session.username = normalized;
            res.json({ message: 'Пользователь переименован', username: normalized });
        });
    });
});

// Пилоты игрока со всеми полями досье — для просмотра и правки в админ-панели.
adminRoutes.get('/users/:userId/pilots', adminMiddleware, (req, res) => {
    db.all(`SELECT id, slot_number, callsign, full_name, mech_name, avatar_path, gender, estate,
                   house_key, house_custom, house_color, house_sigil, house_standing, theme, is_nhp, is_active, updated_at
            FROM pilot_profiles WHERE user_id = ? ORDER BY slot_number`, [req.params.userId], (err, pilots) => {
        if (err) return res.status(500).json({ message: 'Ошибка получения пилотов' });
        res.json({ pilots: pilots || [] });
    });
});

// Правка существующего пилота игрока. Аватар и признак НЧЛ не меняются.
adminRoutes.put('/users/:userId/pilots/:slot', adminMiddleware, (req, res) => {
    const { userId, slot } = req.params;
    const checked = normalizePilotFields(req.body);
    if (checked.error) return res.status(400).json({ message: checked.error });
    const p = checked.pilot;

    db.run(`UPDATE pilot_profiles SET callsign = ?, full_name = ?, mech_name = ?, gender = ?, estate = ?,
                house_key = ?, house_custom = ?, house_color = ?, house_sigil = ?, house_standing = ?,
                theme = COALESCE(?, theme), updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND slot_number = ?`,
        [p.callsign, p.full_name, p.mech_name, p.gender, p.estate,
         p.house_key, p.house_custom, p.house_color, p.house_sigil, p.house_standing,
         p.theme, userId, slot],
        function(err) {
            if (err) return res.status(500).json({ message: 'Ошибка сохранения пилота' });
            if (this.changes === 0) return res.status(404).json({ message: 'Пилот не найден' });
            res.json({ message: 'Пилот сохранён' });
        });
});

// Сделать пилота игрока активным (его тема, сословие и репутация — в терминале игрока).
adminRoutes.post('/users/:userId/pilots/:slot/activate', adminMiddleware, (req, res) => {
    const { userId, slot } = req.params;
    db.get('SELECT id FROM pilot_profiles WHERE user_id = ? AND slot_number = ?', [userId, slot], (err, pilot) => {
        if (err) return res.status(500).json({ message: 'Ошибка' });
        if (!pilot) return res.status(404).json({ message: 'Пилот не найден' });
        db.serialize(() => {
            db.run('UPDATE pilot_profiles SET is_active = 0 WHERE user_id = ?', [userId]);
            db.run('UPDATE pilot_profiles SET is_active = 1 WHERE id = ?', [pilot.id], (err) => {
                if (err) return res.status(500).json({ message: 'Ошибка' });
                res.json({ message: 'Пилот назначен активным' });
            });
        });
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

adminRoutes.delete('/delete-user/:userId', adminMiddleware, (req, res) => {
    const { userId } = req.params;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        db.run('DELETE FROM dialogue_progress WHERE user_id = ?', [userId], (err) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ message: 'Ошибка удаления прогресса' });
            }
            
            db.run('DELETE FROM user_choices WHERE user_id = ?', [userId], (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ message: 'Ошибка удаления выборов' });
                }
                
                db.run('DELETE FROM dialogue_repeats WHERE user_id = ?', [userId], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ message: 'Ошибка удаления повторов' });
                    }
                    
                    db.run('DELETE FROM dialogue_access WHERE user_id = ?', [userId], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ message: 'Ошибка удаления доступа' });
                        }
                        
                        db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ message: 'Ошибка удаления пользователя' });
                            }
                            
                            db.run('COMMIT', (err) => {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ message: 'Ошибка коммита' });
                                }
                                res.json({ message: 'Пользователь удален' });
                            });
                        });
                    });
                });
            });
        });
    });
});

adminRoutes.get('/frequencies', adminMiddleware, (req, res) => {
    db.all('SELECT frequency, title FROM dialogues ORDER BY frequency', (err, rows) => {
        if (err) return res.status(500).json({ message: 'Ошибка получения частот' });
        res.json({ frequencies: rows });
    });
});

adminRoutes.post('/clear-progress', adminMiddleware, (req, res) => {
    const { userId, frequency } = req.body;
    
    if (!userId || !frequency) {
        return res.status(400).json({ message: 'Неверный формат данных' });
    }
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        if (frequency === 'all') {
            db.run('DELETE FROM dialogue_progress WHERE user_id = ?', [userId], (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ message: 'Ошибка удаления прогресса' });
                }
                
                db.run('DELETE FROM user_choices WHERE user_id = ?', [userId], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ message: 'Ошибка удаления выборов' });
                    }
                    
                    db.run('DELETE FROM dialogue_repeats WHERE user_id = ?', [userId], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ message: 'Ошибка удаления повторов' });
                        }
                        
                        db.run('COMMIT', (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ message: 'Ошибка коммита' });
                            }
                            res.json({ message: 'Все прохождения очищены' });
                        });
                    });
                });
            });
        } else {
            db.run('DELETE FROM dialogue_progress WHERE user_id = ? AND frequency = ?', [userId, frequency], (err) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ message: 'Ошибка удаления прогресса' });
                }
                
                db.run('DELETE FROM user_choices WHERE user_id = ? AND frequency = ?', [userId, frequency], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ message: 'Ошибка удаления выборов' });
                    }
                    
                    db.run('DELETE FROM dialogue_repeats WHERE user_id = ? AND frequency = ?', [userId, frequency], (err) => {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ message: 'Ошибка удаления повторов' });
                        }
                        
                        db.run('COMMIT', (err) => {
                            if (err) {
                                db.run('ROLLBACK');
                                return res.status(500).json({ message: 'Ошибка коммита' });
                            }
                            res.json({ message: 'Прохождение очищено' });
                        });
                    });
                });
            });
        }
    });
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

adminRoutes.get('/dialogues-count', adminMiddleware, (req, res) => {
    db.get('SELECT COUNT(*) as count FROM dialogues WHERE is_active != 0', (err, row) => {
        if (err) return res.status(500).json({ message: 'Ошибка получения количества диалогов' });
        res.json({ count: row?.count || 0 });
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
    const getProgress = () => {
        return new Promise((resolve, reject) => {
            db.all(`
                SELECT 
                    u.id as user_id,
                    u.username, 
                    dp.frequency, 
                    dp.progress, 
                    dp.completed, 
                    dp.last_line,
                    COALESCE(d.max_repeats, 1) as max_repeats,
                    COALESCE(dr.repeat_count, 0) as repeat_count
                FROM users u
                LEFT JOIN dialogue_progress dp ON u.id = dp.user_id
                LEFT JOIN dialogues d ON dp.frequency = d.frequency OR d.frequency IS NULL
                LEFT JOIN dialogue_repeats dr ON u.id = dr.user_id AND (dp.frequency = dr.frequency OR dp.frequency IS NULL)
                WHERE d.frequency IS NOT NULL
                ORDER BY u.username, d.frequency
            `, (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });
    };
    
    const getFrequencies = () => {
        return new Promise((resolve, reject) => {
            db.all('SELECT frequency FROM dialogues WHERE is_active != 0', (err, rows) => {
                if (err) reject(err);
                else resolve(rows.map(r => r.frequency));
            });
        });
    };
    
    Promise.all([getProgress(), getFrequencies()])
        .then(([progress, frequencies]) => {
            const result = [];
            const userProgressMap = {};
            
            progress.forEach(p => {
                const key = `${p.user_id}-${p.frequency}`;
                userProgressMap[key] = p;
            });
            
            const users = [...new Set(progress.map(p => ({ id: p.user_id, username: p.username })))];
            
            users.forEach(user => {
                frequencies.forEach(freq => {
                    const key = `${user.id}-${freq}`;
                    const p = userProgressMap[key];
                    
                    if (p) {
                        const repeatCount = p.repeat_count || 0;
                        const completed = p.completed === 1;
                        
                        let status;
                        if (completed) {
                            status = repeatCount > 1 ? 'Да (перепрохождение)' : 'Да';
                        } else {
                            status = p.progress > 0 || p.last_line > 0 ? 'В процессе' : 'Не начато';
                        }
                        
                        result.push({
                            username: user.username,
                            frequency: freq,
                            status: status,
                            max_repeats: p.max_repeats || 1,
                            repeat_count: p.repeat_count || 0
                        });
                    } else {
                        result.push({
                            username: user.username,
                            frequency: freq,
                            status: 'Не начато',
                            max_repeats: 1,
                            repeat_count: 0
                        });
                    }
                });
            });
            
            result.sort((a, b) => {
                if (a.username !== b.username) return a.username.localeCompare(b.username);
                return a.frequency.localeCompare(b.frequency);
            });
            
            res.json({ progress: result });
        })
        .catch(err => {
            res.status(500).json({ message: 'Ошибка прогресса' });
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

// ==================== МУЗЫКА (плейлисты тем) ====================

// Список всех треков (все темы).
adminRoutes.get('/music', adminMiddleware, (req, res) => {
    db.all('SELECT * FROM music_playlist ORDER BY theme, sort_order, id', [], (err, rows) => {
        if (err) return res.status(500).json({ message: 'Ошибка получения треков' });
        res.json({ tracks: rows });
    });
});

// Загрузка трека в плейлист темы.
adminRoutes.post('/music/upload', adminMiddleware, uploadMusic.single('music'), (req, res) => {
    const theme = VALID_THEMES.includes(req.body.theme) ? req.body.theme : 'yellow';

    if (!req.file) {
        Logger.warn('Music upload: файл не получен (поле "music" отсутствует или отклонено фильтром)');
        return res.status(400).json({ message: 'Файл не загружен' });
    }

    if (!validateMusicMagicBytes(req.file)) {
        Logger.warn(`Music upload: отклонён по сигнатуре: ${req.file.originalname} (${req.file.mimetype})`);
        try { fs.unlinkSync(req.file.path); } catch {}
        return res.status(400).json({ message: `Файл "${req.file.originalname}" не распознан как аудио (mp3, wav, ogg, m4a, flac, opus)` });
    }

    const title = (req.body.title || '').toString().trim().slice(0, 120)
        || path.basename(req.file.originalname, path.extname(req.file.originalname)).slice(0, 120)
        || 'Трек';
    const filePath = `/assets/sounds/music/${req.file.filename}`;

    db.get('SELECT COALESCE(MAX(sort_order), 0) as max_sort FROM music_playlist WHERE theme = ?', [theme], (err, row) => {
        if (err) return res.status(500).json({ message: 'Ошибка сервера' });
        db.run('INSERT INTO music_playlist (theme, title, file_path, volume, sort_order) VALUES (?, ?, ?, 100, ?)',
            [theme, title, filePath, (row?.max_sort || 0) + 1],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка сохранения трека' });
                res.status(201).json({ message: 'Трек добавлен', trackId: this.lastID, file_path: filePath });
            });
    });
});

// Обновление названия/громкости трека.
adminRoutes.put('/music/:id', adminMiddleware, (req, res) => {
    const { id } = req.params;
    const { title, volume } = req.body;

    db.get('SELECT * FROM music_playlist WHERE id = ?', [id], (err, track) => {
        if (err) return res.status(500).json({ message: 'Ошибка сервера' });
        if (!track) return res.status(404).json({ message: 'Трек не найден' });

        let newVolume = track.volume;
        if (volume !== undefined) {
            newVolume = Math.max(0, Math.min(100, parseInt(volume)));
            if (Number.isNaN(newVolume)) newVolume = track.volume;
        }

        let newTitle = track.title;
        if (title !== undefined) {
            const t = title.toString().trim().slice(0, 120);
            if (t) newTitle = t;
        }

        db.run('UPDATE music_playlist SET title = ?, volume = ? WHERE id = ?', [newTitle, newVolume, id], (err) => {
            if (err) return res.status(500).json({ message: 'Ошибка обновления трека' });
            res.json({ message: 'Трек обновлен', title: newTitle, volume: newVolume });
        });
    });
});

// Удаление трека (вместе с файлом).
adminRoutes.delete('/music/:id', adminMiddleware, (req, res) => {
    const { id } = req.params;
    db.get('SELECT * FROM music_playlist WHERE id = ?', [id], (err, track) => {
        if (err) return res.status(500).json({ message: 'Ошибка сервера' });
        if (!track) return res.status(404).json({ message: 'Трек не найден' });

        db.run('DELETE FROM music_playlist WHERE id = ?', [id], (err) => {
            if (err) return res.status(500).json({ message: 'Ошибка удаления трека' });

            // Удаляем файл, только если он лежит в директории музыки (защита от path traversal).
            if (track.file_path && track.file_path.startsWith('/assets/sounds/music/')) {
                const rel = track.file_path.replace('/assets/sounds/music/', '').replace(/\.\./g, '');
                const full = path.resolve(path.join(__dirname, 'assets/sounds/music'), rel);
                const base = path.resolve(path.join(__dirname, 'assets/sounds/music'));
                if (full.startsWith(base + path.sep) && fs.existsSync(full)) {
                    try { fs.unlinkSync(full); } catch {}
                }
            }

            res.json({ message: 'Трек удален' });
        });
    });
});

app.use('/api/admin', adminRoutes);

// Роуты редактора диалогов
const dialogueEditorRoutes = require('./routes/dialogue-editor');
app.use('/api/editor', requireAuth, requireAdmin(db), dialogueEditorRoutes(db, upload));

app.get('/api/user-settings', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Не авторизован' });
    }
    
    // Тема — активного пилота; без пилота остаётся тема из настроек пользователя.
    db.get('SELECT auto_play_music, theme, skip_boot, ui_scales FROM user_settings WHERE user_id = ?', [req.session.userId], (err, settings) => {
        if (err) return res.status(500).json({ message: 'Ошибка получения настроек' });

        db.get('SELECT theme FROM pilot_profiles WHERE user_id = ? AND is_active = 1', [req.session.userId], (err, pilot) => {
            if (err) return res.status(500).json({ message: 'Ошибка получения настроек' });

            const pilotTheme = VALID_THEMES.includes(pilot?.theme) ? pilot.theme : null;
            const userTheme = VALID_THEMES.includes(settings?.theme) ? settings.theme : 'yellow';
            const theme = pilotTheme || userTheme;
            const themeSource = pilotTheme ? 'pilot' : 'user';

            if (!settings) {
                db.run('INSERT INTO user_settings (user_id, auto_play_music, theme, skip_boot) VALUES (?, 1, ?, 0)', [req.session.userId, 'yellow'], (err) => {
                    if (err) Logger.error('Error creating user settings:', err.message);
                });
                return res.json({ auto_play_music: 1, theme, theme_source: themeSource, skip_boot: 0, ui_scales: {} });
            }

            res.json({ auto_play_music: settings.auto_play_music, theme, theme_source: themeSource, skip_boot: settings.skip_boot || 0,
                ui_scales: parseUiScales(settings.ui_scales) });
        });
    });
});

const UI_SCALE_CLASSES = ['phone', 'tablet', 'desktop', 'large'];

function parseUiScales(raw) {
    let data = {};
    try { data = JSON.parse(raw || '{}') || {}; } catch { data = {}; }
    const clean = {};
    UI_SCALE_CLASSES.forEach(c => {
        const v = Number(data[c]);
        if (Number.isFinite(v) && v >= 0.75 && v <= 1.5) clean[c] = Math.round(v * 20) / 20;
    });
    return clean;
}

// Множитель масштаба для класса экрана (0.75–1.5, шаг 0.05).
app.post('/api/user-settings/ui-scale', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ message: 'Не авторизован' });
    const { deviceClass, value } = req.body;
    const v = Number(value);
    if (!UI_SCALE_CLASSES.includes(deviceClass)) return res.status(400).json({ message: 'Неизвестный класс экрана' });
    if (!Number.isFinite(v) || v < 0.75 || v > 1.5) return res.status(400).json({ message: 'Масштаб — от 75 до 150 %' });

    db.get('SELECT ui_scales FROM user_settings WHERE user_id = ?', [req.session.userId], (err, row) => {
        if (err) return res.status(500).json({ message: 'Ошибка получения настроек' });
        const scales = parseUiScales(row?.ui_scales);
        scales[deviceClass] = Math.round(v * 20) / 20;
        db.run(`INSERT INTO user_settings (user_id, ui_scales) VALUES (?, ?)
                ON CONFLICT(user_id) DO UPDATE SET ui_scales = excluded.ui_scales`,
            [req.session.userId, JSON.stringify(scales)], (err) => {
                if (err) return res.status(500).json({ message: 'Ошибка сохранения масштаба' });
                res.json({ success: true, ui_scales: scales });
            });
    });
});

app.post('/api/user-settings', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Не авторизован' });
    }
    
    const { auto_play_music, theme, skip_boot } = req.body;

    if (auto_play_music === undefined && theme === undefined && skip_boot === undefined) {
        return res.status(400).json({ message: 'Отсутствуют параметры' });
    }

    if (theme !== undefined && !VALID_THEMES.includes(theme)) {
        return res.status(400).json({ message: 'Неизвестная тема' });
    }

    if (skip_boot !== undefined && typeof skip_boot !== 'number' && typeof skip_boot !== 'boolean') {
        return res.status(400).json({ message: 'Некорректное значение skip_boot' });
    }

    db.get('SELECT * FROM user_settings WHERE user_id = ?', [req.session.userId], (err, existing) => {
        if (err) return res.status(500).json({ message: 'Ошибка получения настроек' });

        // ?? вместо ||: сохранённый 0 (музыка выключена) не должен превращаться в 1.
        const newAutoPlay = auto_play_music !== undefined ? (auto_play_music ? 1 : 0) : (existing?.auto_play_music ?? 1);
        const newTheme = theme || existing?.theme || 'yellow';
        const newSkipBoot = skip_boot !== undefined ? (skip_boot ? 1 : 0) : (existing?.skip_boot || 0);

        // Upsert только этих полей: INSERT OR REPLACE переписал бы строку целиком и стёр ui_scales.
        db.run(`INSERT INTO user_settings (user_id, auto_play_music, theme, skip_boot) VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET auto_play_music = excluded.auto_play_music,
                    theme = excluded.theme, skip_boot = excluded.skip_boot`,
            [req.session.userId, newAutoPlay, newTheme, newSkipBoot],
            function(err) {
                if (err) return res.status(500).json({ message: 'Ошибка сохранения настроек' });
                // Тема принадлежит пилоту: пишем её активному пилоту. user_settings.theme остаётся
                // темой по умолчанию для новых пилотов и для аккаунта без пилота.
                const reply = pilotTheme => res.json({ success: true, auto_play_music: newAutoPlay,
                    theme: pilotTheme || newTheme, theme_source: pilotTheme ? 'pilot' : 'user', skip_boot: newSkipBoot });
                if (theme === undefined) {
                    return db.get('SELECT theme FROM pilot_profiles WHERE user_id = ? AND is_active = 1', [req.session.userId],
                        (err, row) => reply(!err && VALID_THEMES.includes(row?.theme) ? row.theme : null));
                }
                db.run('UPDATE pilot_profiles SET theme = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND is_active = 1',
                    [theme, req.session.userId], function(err) {
                        if (err) return res.status(500).json({ message: 'Ошибка сохранения темы пилота' });
                        reply(this.changes > 0 ? theme : null);
                    });
            });
    });
});

// API для получения диалогов клиентом
app.get('/api/dialogue/:frequency', requireAuth, (req, res) => {
    const { frequency } = req.params;
    const userId = req.session.userId;
    
    db.get('SELECT * FROM dialogues WHERE frequency = ?', [frequency], (err, dialogue) => {
        if (err) return res.status(500).json({ message: 'Ошибка' });
        if (!dialogue) return res.status(404).json({ message: 'Диалог не найден' });
        
        try {
            const allowedUsers = JSON.parse(dialogue.allowed_users || '[-1]');
            if (!allowedUsers.includes(-1) && !allowedUsers.includes(userId)) {
                return res.status(403).json({ message: 'Нет доступа к этому диалогу' });
            }
        } catch (e) {
            return res.status(403).json({ message: 'Нет доступа к этому диалогу' });
        }
        
        const dialogueId = dialogue.id;
        
        db.all(`SELECT c.*, gc.name as gc_name, gc.image as gc_image, 
                gc.portrait_scale as gc_portrait_scale, gc.portrait_x as gc_portrait_x,
                gc.portrait_y as gc_portrait_y, gc.portrait_mirror as gc_portrait_mirror,
                gc.portrait_x_rel as gc_portrait_x_rel, gc.portrait_y_rel as gc_portrait_y_rel,
                gc.id as gc_id,
                gc.default_relation as gc_default_relation
                FROM characters c
                LEFT JOIN global_characters gc ON c.global_character_id = gc.id
                WHERE c.dialogue_id = ? ORDER BY c.sort_order`, [dialogueId], (err, characters) => {
            if (err) { Logger.error('Dialogue characters query error:', err.message); return res.status(500).json({ message: 'Ошибка' }); }
            
            db.all('SELECT id, name, default_relation FROM global_characters', [], (err, allGlobalChars) => {
                if (err) { Logger.error('Dialogue global chars query error:', err.message); return res.status(500).json({ message: 'Ошибка' }); }
                
                const globalCharMap = {};
                allGlobalChars.forEach(gc => { globalCharMap[gc.id] = gc; });
                
                // Репутация читается для активного пилота: строки с pilot_profile_id = 0 —
                // общее наследие (до введения пилотов), строки конкретного пилота приоритетнее.
                db.all(`SELECT ur.*, gc.name as char_name,
                        CASE WHEN ur.pilot_profile_id = COALESCE((SELECT id FROM pilot_profiles WHERE user_id = ? AND is_active = 1), 0)
                             THEN 0 ELSE 1 END AS pilot_priority
                        FROM user_relations ur
                        JOIN global_characters gc ON ur.global_character_id = gc.id
                        WHERE ur.user_id = ?
                          AND (ur.pilot_profile_id = 0
                               OR ur.pilot_profile_id = (SELECT id FROM pilot_profiles WHERE user_id = ? AND is_active = 1))
                        ORDER BY pilot_priority`,
                    [userId, userId, userId], (err, userRels) => {
                    if (err) return res.status(500).json({ message: 'Ошибка' });

                    const relMap = {};
                    userRels.forEach(r => {
                        if (relMap[r.char_name] === undefined) relMap[r.char_name] = r.relation_value;
                    });
                    
                    db.all(`SELECT * FROM conversations WHERE dialogue_id = ? ORDER BY branch_id, sort_order`, 
                        [dialogueId], (err, conversations) => {
                        if (err) return res.status(500).json({ message: 'Ошибка' });
                        
                        const convIds = conversations.map(c => c.id);
                        if (convIds.length === 0) {
                            res.json(formatDialogueForClient(dialogue, characters, [], [], globalCharMap, relMap));
                            return;
                        }
                        
                        db.all(`SELECT * FROM choice_options WHERE conversation_id IN (${convIds.map(() => '?').join(',')}) ORDER BY sort_order`,
                            convIds, (err, choices) => {
                            if (err) return res.status(500).json({ message: 'Ошибка' });
                            // Варианты для сословий отдаются все: нужный выбирает клиент по профилю пилота.
                            db.all(`SELECT * FROM conversation_variants WHERE conversation_id IN (${convIds.map(() => '?').join(',')})`,
                                convIds, (err, variants) => {
                                if (err) return res.status(500).json({ message: 'Ошибка' });
                                res.json(formatDialogueForClient(dialogue, characters, conversations, choices, globalCharMap, relMap, variants));
                            });
                        });
                    });
                });
            });
        });
    });
});

// Переход вариантов реплик на схему «основная реплика — для Лансера».
// Было: аудитории cavalier и lancer (lancer — Лансер и изгнанник). Стало: cavalier и exile.
// Вариант «lancer» переворачивается: его текст становится основной репликой, а прежний основной
// текст — вариантом для Кавалера. Кто что слышал, не меняется.
function migrateConversationVariants() {
    db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversation_variants'", (err, row) => {
        if (err || !row || row.sql.includes("'exile'")) return;
        db.all(`SELECT v.*, c.text AS base_text, c.voiceline AS base_voiceline, c.fake_name AS base_fake_name,
                       c.custom_image AS base_custom_image, c.typing_speed AS base_typing_speed,
                       (SELECT COALESCE(gc.name, ch.name) FROM characters ch LEFT JOIN global_characters gc ON gc.id = ch.global_character_id
                        WHERE ch.id = c.character_id) AS speaker_name,
                       (SELECT COALESCE(gc.image, ch.image) FROM characters ch LEFT JOIN global_characters gc ON gc.id = ch.global_character_id
                        WHERE ch.id = c.character_id) AS speaker_image,
                       (SELECT COUNT(*) FROM conversation_variants cv
                        WHERE cv.conversation_id = v.conversation_id AND cv.audience = 'cavalier') AS has_cavalier
                FROM conversation_variants v JOIN conversations c ON c.id = v.conversation_id
                WHERE v.audience = 'lancer'`, [], (err, lancerRows) => {
            if (err) return Logger.error('Migration error (variants read):', err.message);
            db.serialize(() => {
                db.run('BEGIN TRANSACTION');
                (lancerRows || []).forEach(v => {
                    if (!v.has_cavalier) {
                        db.run(`INSERT INTO conversation_variants (conversation_id, audience, text, voiceline, fake_name, custom_image, typing_speed)
                                VALUES (?, 'cavalier', ?, ?, ?, ?, ?)`,
                            // Пустое имя или портрет у варианта значит «как у основной реплики». Основной
                            // теперь станет лансерская — поэтому Кавалеру явно возвращаем его прежние.
                            [v.conversation_id, v.base_text, v.base_voiceline || '',
                             v.base_fake_name || (v.fake_name ? v.speaker_name || '' : ''),
                             v.base_custom_image || (v.custom_image ? v.speaker_image || '' : ''),
                             v.base_typing_speed || 0]);
                    }
                    db.run(`UPDATE conversations SET text = ?, voiceline = ?, typing_speed = ?,
                                fake_name = ?, custom_image = ? WHERE id = ?`,
                        [v.text, v.voiceline || '', v.typing_speed || 0,
                         v.fake_name || v.base_fake_name || '', v.custom_image || v.base_custom_image || '', v.conversation_id]);
                });
                db.run('DROP TRIGGER IF EXISTS conversation_variants_cleanup');
                db.run(`CREATE TABLE conversation_variants_v2 (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id INTEGER NOT NULL,
                    audience TEXT NOT NULL CHECK (audience IN ('cavalier', 'exile')),
                    text TEXT NOT NULL,
                    voiceline TEXT NOT NULL DEFAULT '',
                    fake_name TEXT NOT NULL DEFAULT '',
                    custom_image TEXT NOT NULL DEFAULT '',
                    typing_speed REAL NOT NULL DEFAULT 0,
                    voice_offset INTEGER NOT NULL DEFAULT 0,
                    typing_profile TEXT NOT NULL DEFAULT '',
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
                    UNIQUE(conversation_id, audience)
                )`);
                db.run(`INSERT INTO conversation_variants_v2 (id, conversation_id, audience, text, voiceline, fake_name, custom_image, typing_speed, updated_at)
                        SELECT id, conversation_id, audience, text, voiceline, fake_name, custom_image, typing_speed, updated_at
                        FROM conversation_variants WHERE audience = 'cavalier'`);
                db.run('DROP TABLE conversation_variants');
                db.run('ALTER TABLE conversation_variants_v2 RENAME TO conversation_variants');
                db.run(`CREATE TRIGGER IF NOT EXISTS conversation_variants_cleanup
                        AFTER DELETE ON conversations
                        BEGIN
                            DELETE FROM conversation_variants WHERE conversation_id = OLD.id;
                        END`);
                db.run('COMMIT', (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        Logger.error('Migration failed (conversation_variants):', err.message);
                    } else {
                        Logger.info(`conversation_variants: основная реплика — для Лансера (перевёрнуто вариантов: ${(lancerRows || []).length})`);
                    }
                });
            });
        });
    });
}

// Профиль скорости по фразам из базы — массив [[внутри, после], …] или null.
function parseTypingProfile(raw) {
    if (!raw) return null;
    try {
        const list = JSON.parse(raw);
        return Array.isArray(list) && list.length ? list : null;
    } catch {
        return null;
    }
}

function formatDialogueForClient(dialogue, characters, conversations, choices, globalCharMap = {}, relMap = {}, variants = []) {
    const result = {
        characters: characters.map(c => ({
            name: c.gc_name || c.name || 'Неизвестный',
            image: c.gc_image || c.image,
            voice: c.voice,
            voiceMode: c.voice_mode || 'none',
            window: c.window,
            // Портрет из каталога, если персонаж привязан к нему; иначе — старые поля диалога.
            ...portraitForClient(c.gc_id ? {
                portrait_scale: c.gc_portrait_scale, portrait_x: c.gc_portrait_x, portrait_y: c.gc_portrait_y,
                portrait_mirror: c.gc_portrait_mirror, portrait_x_rel: c.gc_portrait_x_rel, portrait_y_rel: c.gc_portrait_y_rel
            } : c),
            globalCharacterId: c.global_character_id
        })),
        allowedUsers: JSON.parse(dialogue.allowed_users || '[-1]'),
        isActive: dialogue.is_active !== 0,
        maxRepeats: dialogue.max_repeats !== undefined ? dialogue.max_repeats : 1,
        npcRelations: {},
        conversations: []
    };

    characters.forEach(c => {
        if (c.global_character_id && globalCharMap[c.global_character_id]) {
            const gcName = c.gc_name || c.name;
            if (gcName) {
                result.npcRelations[gcName] = relMap[gcName] !== undefined ? relMap[gcName] : (globalCharMap[c.global_character_id].default_relation || 0);
            }
        }
    });
    
    const branches = {};
    conversations.forEach(c => {
        if (!branches[c.branch_id]) branches[c.branch_id] = [];
        
        const convChoices = choices.filter(ch => ch.conversation_id === c.id);
        const char = characters.find(ch => ch.id === c.character_id);
        
        const convObj = {
            speaker: char ? (char.gc_name || char.name) : 'Система',
            text: c.text
        };
        
        if (c.custom_image) convObj.image = c.custom_image;
        if (c.fake_name) convObj.fakeName = c.fake_name;
        if (c.voiceline) convObj.voiceline = c.voiceline;
        if (c.typing_speed && c.typing_speed > 0) convObj.typingSpeed = c.typing_speed;
        if (c.voice_offset > 0) convObj.voiceOffset = c.voice_offset;
        const profile = parseTypingProfile(c.typing_profile);
        if (profile) convObj.typingProfile = profile;

        const convVariants = variants.filter(v => v.conversation_id === c.id && v.text);
        if (convVariants.length > 0) {
            convObj.variants = {};
            convVariants.forEach(v => {
                convObj.variants[v.audience] = {
                    text: v.text,
                    voiceline: v.voiceline || '',
                    fakeName: v.fake_name || '',
                    image: v.custom_image || '',
                    typingSpeed: v.typing_speed > 0 ? v.typing_speed : 0,
                    voiceOffset: v.voice_offset > 0 ? v.voice_offset : 0,
                    typingProfile: parseTypingProfile(v.typing_profile)
                };
            });
        }

        if (convChoices.length > 0) {
            convObj.hasChoice = true;
            convObj.choice = {
                choiceId: convChoices[0].choice_id,
                options: convChoices.map(ch => {
                    const opt = {
                        id: ch.option_id,
                        text: ch.option_text,
                        targetBranch: ch.target_branch
                    };
                    const gcId = ch.relation_global_char_id || ch.relation_npc_id;
                    if (gcId && globalCharMap[gcId]) {
                        opt.relationNpcName = globalCharMap[gcId].name;
                        opt.relationRequireMin = ch.relation_require_min !== null && ch.relation_require_min !== undefined ? ch.relation_require_min : -100;
                        opt.relationRequireMax = ch.relation_require_max !== null && ch.relation_require_max !== undefined ? ch.relation_require_max : 100;
                        opt.relationEffect = ch.relation_effect || 0;
                    }
                    // Текст ответа для сословия: нужный выбирает клиент по профилю пилота.
                    const optionVariants = {};
                    if (ch.option_text_cavalier) optionVariants.cavalier = ch.option_text_cavalier;
                    if (ch.option_text_exile) optionVariants.exile = ch.option_text_exile;
                    if (Object.keys(optionVariants).length) opt.variants = optionVariants;
                    return opt;
                })
            };
        }
        
        branches[c.branch_id].push(convObj);
    });
    
    if (branches['main'] && branches['main'].length > 0) {
        result.conversations = branches['main'];
    } else {
        const fallbackBranch = Object.keys(branches).find(b => !b.startsWith('detached_') && branches[b].length > 0)
            || Object.keys(branches).find(b => branches[b].length > 0);
        result.conversations = fallbackBranch ? branches[fallbackBranch] : [];
    }
    
    const mainBranchKey = (branches['main'] && branches['main'].length > 0) ? 'main' 
        : Object.keys(branches).find(b => !b.startsWith('detached_') && branches[b].length > 0)
        || Object.keys(branches).find(b => branches[b].length > 0);
    
    Object.keys(branches).forEach(branchId => {
        if (branchId !== mainBranchKey) {
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

// Специальный лимитер для первичной настройки администратора.
const setupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,    // 1 час
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: 'Слишком много попыток, попробуйте позже' }
});

app.post('/api/setup/first-admin', setupLimiter, (req, res) => {
    const { setupKey } = req.body;

    if (!setupKey || setupKey !== config.SETUP_KEY) {
        return res.status(403).json({ message: 'Неверный ключ' });
    }

    // Блокировка повторной настройки: если администратор уже существует — отказ.
    db.get('SELECT id FROM users WHERE is_admin = 1 LIMIT 1', (err, existingAdmin) => {
        if (err) return res.status(500).json({ message: 'Ошибка сервера' });
        if (existingAdmin) {
            return res.status(409).json({ message: 'Администратор уже назначен. Обратитесь к существующему администратору.' });
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
});

app.use((err, req, res, next) => {
    // Ошибки CORS (чужой origin) — отдаём 403, не раскрывая детали.
    if (err && (err.message === 'Not allowed by CORS' || err.name === 'CORSError')) {
        return res.status(403).json({ message: 'Недопустимый источник запроса' });
    }
    // Ошибки загрузки файлов (multer) — отдаём 400.
    if (err && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ message: 'Файл слишком большой (максимум 100 МБ)' });
    }
    // Ошибки с явным HTTP-статусом (например, отказ fileFilter).
    if (err && err.status) {
        return res.status(err.status).json({ message: err.message });
    }
    Logger.error('Unhandled error:', err);
    res.status(500).json({ message: 'Внутренняя ошибка сервера' });
});

function logServerStarted(protocol) {
    const separator = '='.repeat(58);
    console.log(`\n${separator}`);
    console.log('✓ СЕРВЕР ЗАПУЩЕН И РАБОТАЕТ');
    console.log(separator);
    console.log(`Протокол:      ${protocol.toUpperCase()}`);
    console.log(`Локальный API: ${protocol}://localhost:${config.PORT}/api`);
    console.log(`Node.js:       ${process.version}`);
    console.log(`База данных:   ${config.DB_PATH}`);
    console.log(`Запущен:       ${new Date().toLocaleString('ru-RU')}`);
    console.log('Остановка:     Ctrl+C');
    console.log(`${separator}\n`);

    db.get('SELECT 1 AS connected', (err) => {
        if (err) {
            console.error('✗ База данных: ошибка подключения —', err.message);
        } else {
            console.log('✓ База данных: подключение работает');
        }
    });
}

function handleServerError(error) {
    if (error.code === 'EADDRINUSE') {
        console.error(`✗ Порт ${config.PORT} уже занят другим процессом.`);
    } else {
        console.error('✗ Ошибка запуска сервера:', error.message);
    }
}

if (hasSSL) {
    let sslState;
    try {
        sslState = ssl.load(sslKeyPath, sslCertPath);
    } catch (error) {
        console.error(`
✗ SSL: ${error.message}
`);
        process.exit(1);
    }

    const server = https.createServer({ key: sslState.key, cert: sslState.cert }, app);
    server.on('error', handleServerError);
    server.listen(config.PORT, () => {
        logServerStarted('https');
        ssl.describe(sslState).forEach(line => console.log(line));
        Logger.info(`CORS origins: ${config.CORS_ORIGINS.join(', ')}`);
    });
    ssl.watch(server, sslKeyPath, sslCertPath, (level, message) => {
        if (level === 'warn') Logger.warn(message);
        else Logger.info(message);
    }, sslState);
} else {
    const server = http.createServer(app);
    server.on('error', handleServerError);
    server.listen(config.PORT, () => {
        logServerStarted('http');
        Logger.info(`CORS origins: ${config.CORS_ORIGINS.join(', ')}`);
        Logger.warn('Running in HTTP mode (no SSL certificates found)');
    });
}
