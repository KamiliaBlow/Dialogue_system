// server.js
const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const https = require('https');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3000;

// Настройка middleware
app.use(cors({
  origin: ['https://yousite', 'https://yousite'],
  credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'))); // Папка с вашими статическими файлами

// Настройка сессий
app.use(session({
  secret: 'YOURESECRET',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 86400000 } // 24 часа
}));

// Подключение к базе данных
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error('Ошибка при подключении к базе данных:', err.message);
  } else {
    console.log('Подключено к базе данных SQLite');
    // Создаем таблицы при первом запуске
    createTables();
  }
});

// Создание необходимых таблиц
function createTables() {
  // Таблица пользователей
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // Таблица доступа к диалогам
  db.run(`CREATE TABLE IF NOT EXISTS dialogue_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  frequency TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id),
  UNIQUE(frequency, user_id)
)`);

  // Таблица прогресса диалогов
  db.run(`CREATE TABLE IF NOT EXISTS dialogue_progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    frequency TEXT NOT NULL,
    progress INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT 0,
    last_line INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users (id),
    UNIQUE(user_id, frequency)
  )`);

  // Таблица для хранения ответов пользователя
  db.run(`CREATE TABLE IF NOT EXISTS user_choices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    frequency TEXT NOT NULL,
    choice_id TEXT NOT NULL,
    choice_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id)
  )`);
}

// Middleware для проверки авторизации
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Требуется авторизация' });
  }
  next();
}

// Маршрут для регистрации
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ message: 'Необходимо указать имя пользователя и пароль' });
  }
  
  try {
    // Проверяем, существует ли пользователь
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
      }
      
      if (user) {
        return res.status(400).json({ message: 'Пользователь с таким именем уже существует' });
      }
      
      // Хешируем пароль
      const hashedPassword = await bcrypt.hash(password, 10);
      
      // Создаем нового пользователя
      db.run('INSERT INTO users (username, password) VALUES (?, ?)', 
        [username, hashedPassword], 
        function(err) {
          if (err) {
            return res.status(500).json({ message: 'Ошибка при создании пользователя', error: err.message });
          }
          
          // Устанавливаем сессию
          req.session.userId = this.lastID;
          req.session.username = username;
          
          res.status(201).json({ 
            message: 'Пользователь успешно создан',
            userId: this.lastID,
            username
          });
        });
    });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Маршрут для авторизации
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ message: 'Необходимо указать имя пользователя и пароль' });
  }
  
  try {
    // Ищем пользователя
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
      }
      
      if (!user) {
        return res.status(401).json({ message: 'Неверное имя пользователя или пароль' });
      }
      
      // Проверяем пароль
      const isValidPassword = await bcrypt.compare(password, user.password);
      
      if (!isValidPassword) {
        return res.status(401).json({ message: 'Неверное имя пользователя или пароль' });
      }
      
      // Устанавливаем сессию
      req.session.userId = user.id;
      req.session.username = user.username;
      
      res.json({ 
        message: 'Успешная авторизация',
        userId: user.id,
        username: user.username
      });
    });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Проверка авторизации
app.get('/api/check-auth', (req, res) => {
  if (req.session.userId) {
    res.json({
      isAuthenticated: true,
      userId: req.session.userId,
      username: req.session.username
    });
  } else {
    res.json({
      isAuthenticated: false
    });
  }
});

// Выход из системы
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Ошибка при выходе', error: err.message });
    }
    res.json({ message: 'Выход выполнен успешно' });
  });
});

// Получение прогресса диалогов
app.get('/api/dialogue-progress', requireAuth, (req, res) => {
  const userId = req.session.userId;
  
  db.all('SELECT * FROM dialogue_progress WHERE user_id = ?', [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ message: 'Ошибка при получении прогресса диалогов', error: err.message });
    }
    
    res.json({ progress: rows });
  });
});

// Сохранение прогресса диалога
app.post('/api/dialogue-progress', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { frequency, progress, completed, lastLine } = req.body;
  
  db.get('SELECT * FROM dialogue_progress WHERE user_id = ? AND frequency = ?', 
    [userId, frequency], 
    (err, row) => {
      if (err) {
        return res.status(500).json({ message: 'Ошибка базы данных', error: err.message });
      }
      
      if (row) {
        // Обновляем существующую запись
        db.run('UPDATE dialogue_progress SET progress = ?, completed = ?, last_line = ? WHERE user_id = ? AND frequency = ?',
          [progress, completed ? 1 : 0, lastLine, userId, frequency],
          (err) => {
            if (err) {
              return res.status(500).json({ message: 'Ошибка при обновлении прогресса', error: err.message });
            }
            res.json({ message: 'Прогресс обновлен' });
          });
      } else {
        // Создаем новую запись
        db.run('INSERT INTO dialogue_progress (user_id, frequency, progress, completed, last_line) VALUES (?, ?, ?, ?, ?)',
          [userId, frequency, progress, completed ? 1 : 0, lastLine],
          (err) => {
            if (err) {
              return res.status(500).json({ message: 'Ошибка при сохранении прогресса', error: err.message });
            }
            res.json({ message: 'Прогресс сохранен' });
          });
      }
    });
});

// Сохранение выбора пользователя в диалоге
app.post('/api/user-choice', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { frequency, choiceId, choiceText } = req.body;
  
  db.run('INSERT INTO user_choices (user_id, frequency, choice_id, choice_text) VALUES (?, ?, ?, ?)',
    [userId, frequency, choiceId, choiceText],
    function(err) {
      if (err) {
        return res.status(500).json({ message: 'Ошибка при сохранении выбора', error: err.message });
      }
      res.json({ 
        message: 'Выбор сохранен',
        choiceId: this.lastID 
      });
    });
});

// Получение выборов пользователя
app.get('/api/user-choices/:frequency', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const frequency = req.params.frequency;
  
  db.all('SELECT * FROM user_choices WHERE user_id = ? AND frequency = ? ORDER BY created_at',
    [userId, frequency],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ message: 'Ошибка при получении выборов', error: err.message });
      }
      res.json({ choices: rows });
    });
});

// Проверка наличия прав администратора
function requireAdmin(req, res, next) {
  // Проверка авторизации
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Требуется авторизация' });
  }
  
  // Проверка, является ли пользователь администратором
  db.get('SELECT is_admin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
    }
    
    if (!user || user.is_admin !== 1) {
      return res.status(403).json({ message: 'Недостаточно прав для доступа' });
    }
    
    next();
  });
}

// Модифицируем таблицу пользователей, добавляя поле is_admin (если её ещё нет)
db.run(`
  ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT 0
`, err => {
  if (err && !err.message.includes('duplicate column')) {
    console.error('Ошибка при добавлении столбца is_admin:', err.message);
  }
});

// Получение всех пользователей (для админа)
app.get('/api/admin/users', requireAdmin, (req, res) => {
  db.all('SELECT id, username, created_at FROM users ORDER BY created_at DESC', (err, users) => {
    if (err) {
      return res.status(500).json({ message: 'Ошибка при получении списка пользователей', error: err.message });
    }
    
    res.json({ users });
  });
});

// Изменение пароля пользователя (для админа)
app.post('/api/admin/change-password', requireAdmin, async (req, res) => {
  const { userId, newPassword } = req.body;
  
  if (!userId || !newPassword) {
    return res.status(400).json({ message: 'Необходимо указать ID пользователя и новый пароль' });
  }
  
  try {
    // Проверяем, существует ли пользователь
    db.get('SELECT * FROM users WHERE id = ?', [userId], async (err, user) => {
      if (err) {
        return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
      }
      
      if (!user) {
        return res.status(404).json({ message: 'Пользователь не найден' });
      }
      
      // Хешируем новый пароль
      const hashedPassword = await bcrypt.hash(newPassword, 10);
      
      // Обновляем пароль пользователя
      db.run('UPDATE users SET password = ? WHERE id = ?', 
        [hashedPassword, userId], 
        function(err) {
          if (err) {
            return res.status(500).json({ message: 'Ошибка при обновлении пароля', error: err.message });
          }
          
          res.json({ message: 'Пароль пользователя успешно обновлен' });
        });
    });
  } catch (error) {
    res.status(500).json({ message: 'Ошибка сервера', error: error.message });
  }
});

// Получение статистики выборов пользователей
app.get('/api/admin/choice-statistics', requireAdmin, (req, res) => {
  const query = `
    SELECT 
      uc.frequency,
      uc.choice_id,
      uc.choice_text,
      COUNT(*) as count,
      GROUP_CONCAT(u.username) as users
    FROM 
      user_choices uc
    JOIN
      users u ON uc.user_id = u.id
    GROUP BY 
      uc.frequency, uc.choice_id, uc.choice_text
    ORDER BY 
      uc.frequency, uc.choice_id, count DESC
  `;

  db.all(query, (err, stats) => {
    if (err) {
      return res.status(500).json({ 
        message: 'Ошибка при получении статистики выборов', 
        error: err.message 
      });
    }
    
    // Для совместимости с клиентским кодом добавим поле option_id
    const formattedStats = stats.map(stat => ({
      ...stat,
      option_id: stat.choice_text.split(':')[0].trim() // Извлекаем ID опции из текста
    }));
    
    res.json({ statistics: formattedStats });
  });
});

// Получение детализированной статистики для конкретного выбора
app.get('/api/admin/choice-details/:frequency/:choiceId', requireAdmin, (req, res) => {
  const { frequency, choiceId } = req.params;
  
  const query = `
    SELECT 
      u.username,
      uc.choice_text,
      uc.created_at
    FROM 
      user_choices uc
    JOIN
      users u ON uc.user_id = u.id
    WHERE
      uc.frequency = ? AND uc.choice_id = ?
    ORDER BY 
      uc.created_at DESC
  `;

  db.all(query, [frequency, choiceId], (err, details) => {
    if (err) {
      return res.status(500).json({ 
        message: 'Ошибка при получении деталей выбора', 
        error: err.message 
      });
    }
    
    // Для совместимости с клиентским кодом добавим поле option_id
    const formattedDetails = details.map(detail => ({
      ...detail,
      option_id: detail.choice_text.split(':')[0].trim() // Извлекаем ID опции из текста
    }));
    
    res.json({ details: formattedDetails });
  });
});

// Получение прогресса всех пользователей (для админа)
app.get('/api/admin/user-progress', requireAdmin, (req, res) => {
  const query = `
    SELECT 
      u.username,
      dp.frequency,
      dp.progress,
      dp.completed,
      dp.last_line
    FROM 
      dialogue_progress dp
    JOIN
      users u ON dp.user_id = u.id
    ORDER BY 
      u.username, dp.frequency
  `;

  db.all(query, (err, progress) => {
    if (err) {
      return res.status(500).json({ 
        message: 'Ошибка при получении прогресса пользователей', 
        error: err.message 
      });
    }
    
    res.json({ progress });
  });
});

// Проверка, является ли текущий пользователь администратором
app.get('/api/admin/check', requireAuth, (req, res) => {
  db.get('SELECT is_admin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
    }
    
    if (!user) {
      return res.status(404).json({ message: 'Пользователь не найден' });
    }
    
    res.json({ isAdmin: user.is_admin === 1 });
  });
});

// Назначение первого пользователя администратором (одноразовый запрос для инициализации)
app.post('/api/setup/first-admin', async (req, res) => {
  const setupKey = req.body.setupKey;
  
  // Проверка ключа установки (замените этот ключ на свой безопасный ключ)
  if (setupKey !== 'gms4521terminal_secure_setup_key') {
    return res.status(403).json({ message: 'Неверный ключ установки' });
  }
  
  // Получаем первого пользователя и делаем его администратором
  db.get('SELECT id FROM users ORDER BY id LIMIT 1', (err, user) => {
    if (err) {
      return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
    }
    
    if (!user) {
      return res.status(404).json({ message: 'Пользователи не найдены' });
    }
    
    // Обновляем статус администратора для первого пользователя
    db.run('UPDATE users SET is_admin = 1 WHERE id = ?', [user.id], function(err) {
      if (err) {
        return res.status(500).json({ message: 'Ошибка при назначении администратора', error: err.message });
      }
      
      res.json({ 
        message: 'Первый пользователь успешно назначен администратором',
        userId: user.id
      });
    });
  });
});

// Таблица для счетчиков повторных прослушиваний
db.run(`CREATE TABLE IF NOT EXISTS dialogue_repeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  frequency TEXT NOT NULL,
  repeat_count INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users (id),
  UNIQUE(user_id, frequency)
)`);

// 2. Добавить новые эндпоинты:

// Проверка API для счетчиков повторений
app.get('/api/repeat-counts-check', requireAuth, (req, res) => {
  res.json({ available: true });
});

// Получение счетчиков повторных прослушиваний
app.get('/api/repeat-counts', requireAuth, (req, res) => {
  const userId = req.session.userId;
  
  db.all('SELECT frequency, repeat_count FROM dialogue_repeats WHERE user_id = ?', [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ 
        message: 'Ошибка при получении счетчиков повторений', 
        error: err.message 
      });
    }
    
    // Преобразуем результат в объект для удобства использования на клиенте
    const repeatCounts = {};
    rows.forEach(row => {
      repeatCounts[row.frequency] = row.repeat_count;
    });
    
    res.json({ repeatCounts });
  });
});

// Сохранение счетчиков повторных прослушиваний
app.post('/api/repeat-counts', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { repeatCounts } = req.body;
  
  // Проверяем, что repeatCounts - это объект
  if (!repeatCounts || typeof repeatCounts !== 'object') {
    return res.status(400).json({ message: 'Неверный формат данных' });
  }
  
  try {
    // Начинаем транзакцию для атомарного обновления всех счетчиков
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Для каждой частоты обновляем или вставляем запись
      const stmt = db.prepare(`
        INSERT INTO dialogue_repeats (user_id, frequency, repeat_count, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id, frequency) 
        DO UPDATE SET repeat_count = MAX(repeat_count, ?), updated_at = CURRENT_TIMESTAMP
      `);
      
      // Обрабатываем каждую частоту из объекта repeatCounts
      Object.keys(repeatCounts).forEach(frequency => {
        const count = repeatCounts[frequency];
        if (typeof count === 'number' && count >= 0) {
          stmt.run(userId, frequency, count, count);
        }
      });
      
      stmt.finalize();
      
      db.run('COMMIT', err => {
        if (err) {
          return res.status(500).json({ 
            message: 'Ошибка при сохранении счетчиков повторений', 
            error: err.message 
          });
        }
        
        res.json({ message: 'Счетчики повторений успешно сохранены' });
      });
    });
  } catch (error) {
    // В случае ошибки отменяем транзакцию
    db.run('ROLLBACK');
    res.status(500).json({ 
	message: 'Ошибка при сохранении счетчиков повторений', 
      error: error.message 
    });
  }
});

// Сброс счетчика повторений для конкретной частоты (может пригодиться при обновлении контента)
app.post('/api/reset-repeat-count', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { frequency } = req.body;
  
  if (!frequency) {
    return res.status(400).json({ message: 'Необходимо указать частоту' });
  }
  
  db.run('UPDATE dialogue_repeats SET repeat_count = 0, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND frequency = ?',
    [userId, frequency],
    function(err) {
      if (err) {
        return res.status(500).json({ 
          message: 'Ошибка при сбросе счетчика повторений', 
          error: err.message 
        });
      }
      
      // Если записи не было, создаем новую с нулевым счетчиком
      if (this.changes === 0) {
        db.run('INSERT INTO dialogue_repeats (user_id, frequency, repeat_count) VALUES (?, ?, 0)',
          [userId, frequency],
          function(err) {
            if (err) {
              return res.status(500).json({ 
                message: 'Ошибка при создании счетчика повторений', 
                error: err.message 
              });
            }
            
            res.json({ message: 'Счетчик повторений сброшен' });
          });
      } else {
        res.json({ message: 'Счетчик повторений сброшен' });
      }
    });
});

// Добавьте перед секцией запуска сервера

// API для получения списка диалогов, доступных текущему пользователю
app.get('/api/available-frequencies', requireAuth, (req, res) => {
  const userId = req.session.userId;
  
  db.all(`
    SELECT DISTINCT frequency FROM dialogue_access 
    WHERE user_id = ? OR user_id = -1
  `, [userId], (err, accessRows) => {
    if (err) {
      return res.status(500).json({ 
        message: 'Ошибка при получении доступных частот', 
        error: err.message 
      });
    }
    
    // Преобразуем результат в массив частот
    const availableFrequencies = accessRows.map(row => row.frequency);
    
    res.json({ availableFrequencies });
  });
});

// API для установки доступа к диалогу (только для админа)
app.post('/api/admin/set-dialogue-access', requireAdmin, (req, res) => {
  const { frequency, userIds } = req.body;
  
  if (!frequency || !Array.isArray(userIds)) {
    return res.status(400).json({ message: 'Неверный формат данных' });
  }
  
  try {
    // Начинаем транзакцию
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Сначала удаляем все существующие записи доступа для этой частоты
      db.run('DELETE FROM dialogue_access WHERE frequency = ?', [frequency], (err) => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ 
            message: 'Ошибка при обновлении доступа к диалогу', 
            error: err.message 
          });
        }
        
        // Если массив содержит -1, добавляем запись "доступно всем"
        if (userIds.includes(-1)) {
          db.run('INSERT INTO dialogue_access (frequency, user_id) VALUES (?, -1)', [frequency], (err) => {
            if (err) {
              db.run('ROLLBACK');
              return res.status(500).json({ 
                message: 'Ошибка при установке общего доступа к диалогу', 
                error: err.message 
              });
            }
            
            db.run('COMMIT');
            return res.json({ message: 'Доступ к диалогу установлен для всех пользователей' });
          });
        } else {
          // Иначе добавляем записи для каждого указанного ID пользователя
          const stmt = db.prepare('INSERT INTO dialogue_access (frequency, user_id) VALUES (?, ?)');
          
          let hasError = false;
          userIds.forEach(userId => {
            stmt.run([frequency, userId], (err) => {
              if (err && !hasError) {
                hasError = true;
                db.run('ROLLBACK');
                return res.status(500).json({ 
                  message: 'Ошибка при установке доступа к диалогу для пользователя', 
                  error: err.message 
                });
              }
            });
          });
          
          stmt.finalize();
          
          if (!hasError) {
            db.run('COMMIT');
            return res.json({ 
              message: 'Доступ к диалогу установлен для указанных пользователей',
              userIds: userIds
            });
          }
        }
      });
    });
  } catch (error) {
    db.run('ROLLBACK');
    res.status(500).json({ 
      message: 'Ошибка при установке доступа к диалогу', 
      error: error.message 
    });
  }
});

// API для получения настроек доступа к диалогу (для админа)
app.get('/api/admin/dialogue-access/:frequency', requireAdmin, (req, res) => {
  const frequency = req.params.frequency;
  
  db.all('SELECT user_id FROM dialogue_access WHERE frequency = ? ORDER BY user_id', [frequency], (err, rows) => {
    if (err) {
      return res.status(500).json({ 
        message: 'Ошибка при получении настроек доступа к диалогу', 
        error: err.message 
      });
    }
    
    // Преобразуем результат в массив ID пользователей
    const userIds = rows.map(row => row.user_id);
    
    // Проверяем, доступен ли диалог всем
    const isPublic = userIds.includes(-1);
    
    res.json({ 
      frequency, 
      isPublic,
      userIds: isPublic ? [-1] : userIds 
    });
  });
});

// Начальная загрузка доступов к диалогам из клиентского кода в базу данных
app.post('/api/admin/initialize-dialogue-access', requireAdmin, (req, res) => {
  const { dialogues } = req.body;
  
  if (!dialogues || typeof dialogues !== 'object') {
    return res.status(400).json({ message: 'Неверный формат данных' });
  }
  
  try {
    // Начинаем транзакцию
    db.serialize(() => {
      db.run('BEGIN TRANSACTION');
      
      // Для каждого диалога в объекте
      Object.keys(dialogues).forEach(frequency => {
        const dialogue = dialogues[frequency];
        const allowedUsers = dialogue.allowedUsers || [-1]; // По умолчанию доступно всем
        
        // Удаляем существующие записи для этой частоты
        db.run('DELETE FROM dialogue_access WHERE frequency = ?', [frequency]);
        
        // Вставляем новые записи
        const stmt = db.prepare('INSERT INTO dialogue_access (frequency, user_id) VALUES (?, ?)');
        
        allowedUsers.forEach(userId => {
          stmt.run([frequency, userId]);
        });
        
        stmt.finalize();
      });
      
      db.run('COMMIT', err => {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ 
            message: 'Ошибка при инициализации доступа к диалогам', 
            error: err.message 
          });
        }
        
        res.json({ message: 'Доступ к диалогам успешно инициализирован' });
      });
    });
  } catch (error) {
    db.run('ROLLBACK');
    res.status(500).json({ 
      message: 'Ошибка при инициализации доступа к диалогам', 
      error: error.message 
    });
  }
});

// Настройка HTTPS
const httpsOptions = {
  key: fs.readFileSync(path.join(__dirname, 'ssl', 'privkey.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'ssl', 'cert.pem'))
};

// Запуск сервера
https.createServer(httpsOptions, app).listen(3000, () => {
  console.log('HTTPS сервер запущен на порту 3000');
});