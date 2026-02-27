// Кэшируем DOM-элементы для улучшения производительности
import debug from './debug.js';

const elements = {
    powerButton: document.getElementById('power-button'),
    skipButton: document.getElementById('skip-button'),
    logoContainer: document.getElementById('logo-container'),
    campaignLogo: document.getElementById('campaign-logo'),
    terminalContainer: document.getElementById('terminal-container'),
    codeScroll: document.getElementById('code-scroll'),
    powerSound: document.getElementById('power-sound'),
    loadingBar: document.getElementById('loading-bar'),
    status: document.getElementById('status'),
    usernameElement: document.getElementById('username')
};

let API_URL = null;

function capitalizeName(name) {
    if (!name) return '';
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

async function loadConfig() {
    try {
        const timestamp = Date.now();
        const module = await import(`./config.js?t=${timestamp}`);
        API_URL = module.default.API_URL;
    } catch (error) {
        console.error('Failed to load config:', error);
        API_URL = window.location.origin + '/api';
    }
}

async function loadUsername() {
    if (!API_URL) await loadConfig();
    
    try {
        const url = `${API_URL}/check-auth`;
        debug('Fetching:', url);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch(url, {
            credentials: 'include',
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
            elements.usernameElement.textContent = 'ГОСТЬ';
            return;
        }
        
        const data = await response.json();
        if (data.isAuthenticated && data.username) {
            elements.usernameElement.textContent = capitalizeName(data.username);
        } else {
            elements.usernameElement.textContent = 'ГОСТЬ';
        }
    } catch (error) {
        console.error('Error loading username:', error);
        elements.usernameElement.textContent = 'ГОСТЬ';
    }
}

// Статусы загрузки
const statuses = [
    'GENERAL MASSIVE SYSTEM INIT',
    'ИНИЦИАЛИЗАЦИЯ СИСТЕМЫ...',
    'ПРОВЕРКА КРИПТОЗАЩИТЫ...',
    'УСТАНОВКА СВЯЗИ...',
    'СИСТЕМА ГОТОВА'
];

// Инициализация терминального кода
function initTerminalCodeScroll() {
    const codeGenerator = new TerminalCodeGenerator();
    let lineCount = 0;

    function addCodeLine() {
        const line = document.createElement('div');
        line.classList.add('terminal-line');
        line.textContent = `${lineCount.toString().padStart(4, '0')}: ${codeGenerator.generateCodeLine()}`;
        elements.codeScroll.appendChild(line);

        // Резкое появление строк
        requestAnimationFrame(() => {
            line.classList.add('visible');
        });
        lineCount++;

        // Удаляем старые строки, если их слишком много
        if (elements.codeScroll.children.length > 300) {
            elements.codeScroll.removeChild(elements.codeScroll.firstChild);
        }
    }

    function animateScroll() {
        // Медленная прокрутка
        elements.codeScroll.style.transform = `translateY(-${lineCount * 0.3}px)`;

        // Добавляем новую строку с небольшой задержкой
        if (Math.random() < 0.08) {  // Случайность добавления строк (замедлено)
            addCodeLine();
        }
        requestAnimationFrame(animateScroll);
    }

    // Начальная генерация строк
    for (let i = 0; i < 50; i++) {
        addCodeLine();
    }
    animateScroll();
}

// Функция плавного перехода между страницами
function smoothPageTransition() {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: '100%',
        height: '100%',
        backgroundColor: 'black',
        zIndex: '9999',
        opacity: '0',
        transition: 'opacity 1s ease-in-out'
    });

    document.body.appendChild(overlay);
    // Плавное затухание текущей страницы
    setTimeout(() => {
        overlay.style.opacity = '1';

        // Переход на следующую страницу с задержкой
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1000);
    }, 500);
}

// Создание анимированной загрузочной полосы с эффектами задержки
function createLoadingBar() {
    const totalDuration = 43000; // 41 секунда
    // Массив с точками "подтормаживания"
    const stutterPoints = [
        { at: 0.2, duration: 500 },   // небольшая задержка на 20%
        { at: 0.5, duration: 1000 },  // более существенная задержка на 50%
        { at: 0.75, duration: 700 }   // средняя задержка на 75%
    ];
    return new Promise((resolve) => {
        let startTime = null;
        function animateLoading(timestamp) {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            // Проверяем точки подтормаживания
            const stutter = stutterPoints.find(point =>
                Math.abs((elapsed / totalDuration) - point.at) < 0.05
            );
            if (stutter) {
                // Имитация торможения
                return new Promise(res => setTimeout(res, stutter.duration))
                    .then(() => requestAnimationFrame(animateLoading));
            }
            const progress = Math.min(elapsed / totalDuration, 1);
            elements.loadingBar.style.width = `${progress * 100}%`;
            if (progress < 1) {
                requestAnimationFrame(animateLoading);
            } else {
                resolve();
            }
        }
        requestAnimationFrame(animateLoading);
    });
}

// Функция анимированного вывода статусов
function typeStatus() {
    let currentIndex = 0;
    // Создаем промис для загрузочной полосы
    const loadingBarPromise = createLoadingBar();

    function nextStatus() {
        if (currentIndex < statuses.length) {
            // Очищаем предыдущее сообщение
            elements.status.textContent = '';

            // Анимация печати сообщения
            let messageIndex = 0;
            const currentMessage = statuses[currentIndex];

            function typeMessage() {
                if (messageIndex < currentMessage.length) {
                    elements.status.textContent += currentMessage[messageIndex];
                    messageIndex++;
                    setTimeout(typeMessage, 50); // Скорость печати
                } else {
                    // Перейти к следующему сообщению через некоторое время
                    setTimeout(() => {
                        currentIndex++;
                        nextStatus();
                    }, 10000);
                }
            }
            typeMessage();
        } else {
            // Дожидаемся полной загрузки полосы
            loadingBarPromise.then(() => {
                smoothPageTransition();
            });
        }
    }
    nextStatus();
}

// Функция плавного затухания звука
function fadeOutAudio(audio, duration = 2000) {
    const originalVolume = audio.volume;
    const steps = 20;
    const stepTime = duration / steps;
    const volumeDecrement = originalVolume / steps;
    return new Promise(resolve => {
        const fadeInterval = setInterval(() => {
            if (audio.volume > volumeDecrement) {
                audio.volume -= volumeDecrement;
            } else {
                audio.pause();
                audio.volume = originalVolume; // Восстанавливаем громкость
                clearInterval(fadeInterval);
                resolve();
            }
        }, stepTime);
    });
}

// Инициализация обработчиков событий
function initEventListeners() {
    // Обработчик для кнопки включения
    elements.powerButton.addEventListener('click', function() {
        // Скрываем кнопку "Пропустить запуск"
        elements.skipButton.hidden = true;

        // Воспроизводим звук
        elements.powerSound.play();

        // Показываем логотип
        elements.logoContainer.style.display = 'flex';

        // Добавляем класс анимации с небольшой задержкой
        setTimeout(() => {
            elements.campaignLogo.classList.add('show');
        }, 500);

        // Затухание логотипа через 3 секунды
        setTimeout(() => {
            elements.campaignLogo.classList.add('fade');
        }, 3000);

        // Запуск основного интерфейса через 4 секунды
        setTimeout(() => {
            elements.logoContainer.style.display = 'none';
            elements.powerButton.style.display = 'none';
            elements.terminalContainer.style.display = 'block';

            // Показываем приветствие
            document.getElementById('welcome-message').style.display = 'block';

            initTerminalCodeScroll();
            typeStatus();

            // Затухание звука через 42 секунды
            setTimeout(() => {
                fadeOutAudio(elements.powerSound);
            }, 42000);
        }, 4000);
    });

    // Обработчик для кнопки пропуска
    elements.skipButton.addEventListener('click', function() {
        smoothPageTransition();
    });
}

// При загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    // Показываем кнопку "Пропустить запуск"
    elements.skipButton.hidden = false;

    // Загружаем имя пользователя
    loadUsername();

    // Инициализируем обработчики событий
    initEventListeners();

    // Предзагрузка аудиофайла
    elements.powerSound.load();
});

