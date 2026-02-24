let games = null;
let API_URL = null;
let ASSETS_URL = null;
let dialoguesCache = {};

async function loadConfig() {
    try {
        const appConfigModule = await import('./config.js');
        API_URL = appConfigModule.default.API_URL;
        ASSETS_URL = appConfigModule.default.ASSETS_URL;
        
        const response = await fetch(`${API_URL}/frequencies`, {
            credentials: 'include'
        });
        
        const data = await response.json();
        const frequencies = data.frequencies || [];
        
        games = {
            customGame: {
                frequencies: frequencies,
                dialogues: {}
            }
        };
        
        console.log('Config loaded from API');
        console.log('Available frequencies:', frequencies);
        
    } catch (error) {
        console.error('Failed to load config from API:', error);
        
        try {
            const configModule = await import('../Config.js');
            games = configModule.default;
            const appConfigModule = await import('./config.js');
            API_URL = appConfigModule.default.API_URL;
            ASSETS_URL = appConfigModule.default.ASSETS_URL;
            console.log('Config loaded from Config.js (fallback)');
        } catch (fallbackError) {
            console.error('Critical: Failed to load config:', fallbackError);
            throw new Error('Не удалось загрузить конфигурацию');
        }
    }
}

function getAssetUrl(path) {
    if (!path) return '';
    if (path.startsWith('http://') || path.startsWith('https://')) return path;
    
    if (!ASSETS_URL || ASSETS_URL.includes('DOMENHERE') || ASSETS_URL.includes('localhost')) {
        return path;
    }
    
    if (path.startsWith('/assets/')) return ASSETS_URL.replace('/assets', '') + path;
    if (path.startsWith('assets/')) return ASSETS_URL + path.replace('assets/', '/');
    return path;
}

// Загрузка конкретного диалога из БД
async function loadDialogueFromDB(frequency) {
    if (dialoguesCache[frequency]) {
        console.log(`Dialogue ${frequency} loaded from cache`);
        return dialoguesCache[frequency];
    }
    
    try {
        console.log(`Loading dialogue ${frequency} from API...`);
        const response = await fetch(`${API_URL}/dialogue/${frequency}`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.warn(`Dialogue ${frequency} not found in DB, status: ${response.status}`);
            return null;
        }
        
        const data = await response.json();
        console.log(`Dialogue ${frequency} loaded from DB:`, data);
        
        const dialogue = {
            characters: data.characters || [],
            allowedUsers: data.allowedUsers || [-1],
            conversations: data.conversations || []
        };
        
        if (data.branches) {
            Object.keys(data.branches).forEach(key => {
                if (key !== 'conversations') {
                    dialogue[key] = data.branches[key];
                }
            });
        }
        
        dialoguesCache[frequency] = dialogue;
        console.log(`Processed dialogue for ${frequency}:`, dialogue);
        return dialogue;
        
    } catch (error) {
        console.error('Error loading dialogue:', error);
        return null;
    }
}

// Состояние приложения
const state = {
    currentGame: 'customGame',
    freqCount: 0,
    count: 0,
    isTransmissionEnded: false,
    currentDialogue: null,
    initialDialogue: null,
    currentChoiceId: null,
    userChoices: {},
    userName: '',
    typingTimeout: null,
    justMadeChoice: false,
    repeatCount: {},
    currentVoiceline: null,
    lastPortrait: {
        window1: null,
        window2: null
    }
};

/**
 * Инициализация страницы
 */
async function initializePage() {
    try {
        // Загружаем конфигурацию
        await loadConfig();
        
        if (!games || !games.customGame) {
            throw new Error('Конфигурация не загружена');
        }
        
        // Сбрасываем freqCount на 0 при инициализации
        state.freqCount = 0;
        
        console.log('Конфигурация загружена:', games);
        console.log('Доступные частоты:', games.customGame.frequencies);
        
        // Загружаем счетчики повторных прослушиваний
        await loadRepeatCounts();
        
        // Проверка авторизации
        const authResponse = await fetch(`${API_URL}/check-auth`, {
            credentials: 'include'
        });
        
        const authData = await authResponse.json();
        
        if (!authData.isAuthenticated) {
            window.location.href = 'login.html';
            return;
        }
        
        state.userName = authData.username;
        state.userId = authData.userId;
        console.log(`Пользователь аутентифицирован: ${state.userName} (ID: ${state.userId})`);
        
		// Загрузка доступных частот для пользователя
        await loadAvailableFrequencies();
		
        // Установка начальной частоты
        updateFrequencyDisplay();
        
        // Загрузка выборов пользователя
        await loadUserChoices();
        
        // Инициализация текущей частоты
        await initializeTransmission();
    } catch (error) {
        console.error('Ошибка при инициализации страницы:', error);
        initializeTransmission();
    }
}

/**
 * Загрузка доступных частот для пользователя
 */
async function loadAvailableFrequencies() {
    // Проверяем, что конфигурация загружена
    if (!games || !games[state.currentGame]) {
        console.error('Конфигурация не загружена в loadAvailableFrequencies');
        state.availableFrequencies = [];
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/available-frequencies`, {
            credentials: 'include'
        });
        
        if (!response.ok) {
            console.error('Ошибка при получении доступных частот');
            checkLocalDialogueAccess();
            return;
        }
        
        const data = await response.json();
        state.availableFrequencies = data.availableFrequencies || [];
        
        console.log("Доступные частоты для пользователя:", state.availableFrequencies);
        
        // Если у нас нет явного API, мы также можем проверить доступ на клиенте
        // на основе информации в объекте диалогов
        checkLocalDialogueAccess();
        
    } catch (error) {
        console.error('Ошибка при загрузке доступных частот:', error);
        // В случае ошибки используем все частоты из конфигурации
        state.availableFrequencies = [...games[state.currentGame]['frequencies']];
    }
}

/**
 * Проверка доступа к диалогам локально (если API недоступно)
 */
function checkLocalDialogueAccess() {
    // Проверяем, что конфигурация загружена
    if (!games || !games[state.currentGame]) {
        console.error('Конфигурация не загружена в checkLocalDialogueAccess');
        return;
    }
    
    // Получаем текущую игру и диалоги
    const game = games[state.currentGame];
    const allFrequencies = game['frequencies'];
    
    // Если еще не установлен массив доступных частот, инициализируем его
    if (!state.availableFrequencies) {
        state.availableFrequencies = [];
    }
    
    // Проверяем каждую частоту
    allFrequencies.forEach(frequency => {
        if (state.availableFrequencies.includes(frequency)) {
            // Уже добавлена через API, пропускаем
            return;
        }
        
        const dialogue = game['dialogues'][frequency];
        if (!dialogue) return;
        
        // Проверяем настройки доступа
        const allowedUsers = dialogue.allowedUsers || [-1]; // По умолчанию доступно всем
        
        // Если диалог доступен всем или текущему пользователю
        if (allowedUsers.includes(-1) || allowedUsers.includes(state.userId)) {
            state.availableFrequencies.push(frequency);
        }
    });
    
    console.log("Доступные частоты после локальной проверки:", state.availableFrequencies);
}

/**
 * Проверка доступа к частоте
 * @param {string} frequency - Частота для проверки
 * @returns {boolean} - Доступна ли частота
 */
function hasAccessToFrequency(frequency) {
    if (!state.availableFrequencies || state.availableFrequencies.length === 0) {
        return true;
    }
    
    return state.availableFrequencies.includes(frequency);
}

/**
 * Загрузка выборов пользователя
 */
async function loadUserChoices() {
    try {
        const progressResponse = await fetch(`${API_URL}/dialogue-progress`, {
            credentials: 'include'
        });
        
        if (!progressResponse.ok) {
            console.error('Ошибка при получении прогресса диалогов');
            return;
        }
        
        const progressData = await progressResponse.json();
        const allFrequencies = (progressData.progress || []).map(p => p.frequency);
        
        // Добавляем текущую частоту, если её нет в списке
        const currentFrequency = getCurrentFrequency();
        if (!allFrequencies.includes(currentFrequency)) {
            allFrequencies.push(currentFrequency);
        }
        
        console.log("Загружаем выборы для частот:", allFrequencies);
        
        // Загружаем выборы для всех частот
        for (const frequency of allFrequencies) {
            const choicesResponse = await fetch(`${API_URL}/user-choices/${frequency}`, {
                credentials: 'include'
            });
            
            if (choicesResponse.ok) {
                const choicesData = await choicesResponse.json();
                state.userChoices[frequency] = choicesData.choices || [];
                console.log(`Загружены выборы для частоты ${frequency}:`, state.userChoices[frequency]);
            }
        }
    } catch (error) {
        console.error('Ошибка при загрузке выборов пользователя:', error);
    }
}

/**
 * Получить текущую частоту
 */
function getCurrentFrequency() {
    // Проверяем, загружена ли конфигурация
    if (!games || !games[state.currentGame] || !games[state.currentGame]['frequencies']) {
        console.error('Конфигурация не загружена или отсутствуют частоты');
        return 'UNKNOWN';
    }
    
    const frequencies = games[state.currentGame]['frequencies'];
    
    // Проверяем, существует ли частота по текущему индексу
    if (state.freqCount >= 0 && state.freqCount < frequencies.length) {
        return frequencies[state.freqCount];
    }
    
    // Если индекс некорректный, возвращаем первую доступную частоту
    console.warn(`freqCount ${state.freqCount} вне диапазона, сброс на 0`);
    state.freqCount = 0;
    return frequencies[0];
}

/**
 * Обновление отображения частоты
 */
function updateFrequencyDisplay() {
    $('.freq').text(getCurrentFrequency());
}

/**
 * Инициализация передачи
 */
async function initializeTransmission() {
    // Проверяем, что конфигурация загружена
    if (!games || !games[state.currentGame]) {
        console.error('Конфигурация не загружена в initializeTransmission');
        $('#text').text('*ОШИБКА КОНФИГУРАЦИИ*');
        $('#c-char').text('СИСТЕМА:');
        $('#start-transmission, #repeat-transmission').addClass('hidden');
        return;
    }
    
    const currentFrequency = getCurrentFrequency();
    console.log(`Инициализация передачи для частоты ${currentFrequency}`);
    
    // Проверяем доступ к текущей частоте
    if (!hasAccessToFrequency(currentFrequency)) {
        console.log(`У пользователя нет доступа к частоте ${currentFrequency}, отображаем сообщение о блокировке`);
        $('#text').text('*ДОСТУП ЗАПРЕЩЕН*');
        $('#c-char').text('СИСТЕМА:');
        $('#char-1, #char-2').css('background-image', `url(${getAssetUrl('assets/images/portraits/static.gif')})`);
        $('.overlay').css('opacity', '0.3');
        $('#start-transmission, #repeat-transmission').addClass('hidden');
        return;
    }
    
    // Скрываем кнопку повтора по умолчанию при инициализации
    $('#repeat-transmission').addClass('hidden');
    
    // Проверяем счетчик прослушиваний
    const repeatCount = state.repeatCount[currentFrequency] || 0;
    
    // Установка статических изображений для персонажей
    $('#char-1, #char-2').css('background-image', `url(${getAssetUrl('assets/images/portraits/static.gif')})`);
    
    // Загрузка диалога - сначала из БД, потом fallback на Config.js
    state.currentDialogue = await loadDialogueFromDB(currentFrequency);
    
    if (!state.currentDialogue && games[state.currentGame] && games[state.currentGame]['dialogues']) {
        state.currentDialogue = games[state.currentGame]['dialogues'][currentFrequency];
    }
    
    if (!state.currentDialogue) {
        $('#text').text('*НЕТ СВЯЗИ*');
        $('#c-char').text('');
        $('#start-transmission, #repeat-transmission').addClass('hidden');
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/dialogue-progress`, {
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            const dialogueProgress = (data.progress || []).find(p => p.frequency === currentFrequency);
            
            if (dialogueProgress) {
                console.log(`Найден прогресс для частоты ${currentFrequency}:`, dialogueProgress);
                
                let savedCount = parseInt(dialogueProgress.lastLine || dialogueProgress.progress || 0);
                console.log(`Восстановлена позиция диалога: ${savedCount}`);
                
                if (savedCount >= state.currentDialogue.conversations.length) {
                    console.log(`Сохраненная позиция ${savedCount} выходит за пределы диалога длиной ${state.currentDialogue.conversations.length}`);
                    
                    if (!dialogueProgress.completed) {
                        savedCount = state.currentDialogue.conversations.length - 1;
                        console.log(`Корректируем позицию на ${savedCount}`);
                    }
                }
				
				// ВАЖНОЕ ИЗМЕНЕНИЕ: Если диалог не завершен, вычитаем 1 из savedCount, 
				// чтобы при возобновлении показать строку, на которой остановились
				if (!dialogueProgress.completed && savedCount > 0) {
					savedCount--;
					console.log(`Декрементируем позицию для повторного показа текущей строки: ${savedCount}`);
				}
				
				state.count = savedCount;
				
				if (dialogueProgress.completed) {
					// Если диалог уже завершен, показываем соответствующее состояние
					// и учитываем счетчик повторных прослушиваний
					if (repeatCount === 1) {
						// Показываем кнопку повтора только если диалог был прослушан ровно 1 раз
						$('#repeat-transmission').removeClass('hidden');
					} else {
						$('#repeat-transmission').addClass('hidden');
					}
					showCompletedDialogueState();
				} else {
					// Если диалог не завершен, показываем соответствующую кнопку для продолжения
					if (state.count >= state.currentDialogue.conversations.length - 1) {
						$('#text').text('*ПОСЛЕДНЯЯ СТРОКА ДИАЛОГА*');
						$('#c-char').text('');
						
						$('#start-transmission').removeClass('hidden');
						$('#start-transmission').find('.start-link').text('Показать последнюю строку');
					} else {
						$('#text').text('*ПЕРЕДАЧА ПРЕРВАНА*');
						$('#c-char').text('');
						$('#start-transmission').removeClass('hidden');
						$('#start-transmission').find('.start-link').text('Продолжить передачу');
					}
					// Всегда скрываем кнопку повтора, если диалог не завершен
					$('#repeat-transmission').addClass('hidden');
				}
			} else {
				console.log(`Прогресс для частоты ${currentFrequency} не найден, начинаем с начала`);
				state.count = 0;
				state.isTransmissionEnded = false;
				// Если диалог еще не начат, всегда скрываем кнопку повтора
				$('#repeat-transmission').addClass('hidden');
				showStartButton();
			}
		} else {
			throw new Error('Ошибка при получении прогресса диалогов');
		}
	} catch (error) {
		console.error('Ошибка при проверке статуса диалога:', error);
		state.count = 0;
		state.isTransmissionEnded = false;
		// При ошибке тоже скрываем кнопку повтора
		$('#repeat-transmission').addClass('hidden');
		showStartButton();
	}

	setTimeout(logDialogueState, 100);
}

/**
 * Показать состояние завершенного диалога
 */
function showCompletedDialogueState() {
    const currentFrequency = getCurrentFrequency();
    const repeatCount = state.repeatCount[currentFrequency] || 0;
        
    $('#text').text('*ДИАЛОГ ЗАВЕРШЕН*');
    $('#c-char').text('');
    $('#char-1, #char-2').css('background-image', `url(${getAssetUrl('assets/images/portraits/static.gif')})`);
    $('.overlay').css('opacity', '0.3');
    $('#start-transmission').addClass('hidden');
    
    // Показываем кнопку повтора только если диалог уже был прослушан ровно один раз
    // (Важное изменение: проверяем на точное равенство 1, а не <= 1)
    if (repeatCount === 0) {
        $('#repeat-transmission').removeClass('hidden');
        console.log(`Диалог на частоте ${currentFrequency} был прослушан ${repeatCount} раз, показываем кнопку повтора`);
    } else {
        $('#repeat-transmission').addClass('hidden');
        console.log(`Диалог на частоте ${currentFrequency} был прослушан ${repeatCount} раз, скрываем кнопку повтора`);
    }
    
    state.isTransmissionEnded = true;
}

/**
 * Показать кнопку начала передачи
 */
function showStartButton() {
    $('#text').text('');
    $('#c-char').text('');
    // Всегда скрываем кнопку повтора при отображении кнопки начала передачи
    $('#repeat-transmission').addClass('hidden');
    $('#start-transmission').removeClass('hidden');
    $('#start-transmission').find('.start-link').text('Прослушать передачу');
}

/**
 * Текущий диалог
 * @param {boolean} resetCount - Сбросить счетчик
 */
function currentConversation(resetCount = false) {
    const currentFrequency = getCurrentFrequency();
    
    // Если resetCount равно true, начинаем диалог сначала
    if (resetCount) {
        state.count = 0;
        state.isTransmissionEnded = false;
    }
    
    // Проверяем, загружен ли диалог
    if (!state.currentDialogue) {
        state.currentDialogue = games[state.currentGame]['dialogues'][currentFrequency];
        if (!state.currentDialogue) {
            console.error(`Диалог для частоты ${currentFrequency} не найден`);
            return;
        }
    }
    
    // Сохраняем начальное состояние диалога
    state.initialDialogue = JSON.parse(JSON.stringify(state.currentDialogue));
    
    // Скрываем кнопку "Прослушать передачу"
    $('#start-transmission').addClass('hidden');
    
    // Устанавливаем изображения персонажей
    initializeCharacterPortraits();
    
    console.log(`Начинаем диалог для частоты ${currentFrequency} с позиции ${state.count}`);
    
    // Очищаем текст перед началом
    $('#text').text('');
    $('#c-char').text('');
    
    // Устанавливаем флаг незавершенного диалога
    state.isTransmissionEnded = false;
    
    // Запускаем следующую строку диалога
    showNextLine();
    
    // Сохраняем прогресс сразу при начале просмотра строки
    saveDialogueProgress(currentFrequency, false);
}

/**
 * Показать следующую строку диалога
 */
function showNextLine() {
    console.log(`showNextLine вызвана с count=${state.count}, isTransmissionEnded=${state.isTransmissionEnded}`);
    
    if (state.isTransmissionEnded) {
        console.log('Передача уже завершена, ничего не делаем');
        return;
    }
    
    if (!state.currentDialogue) {
        console.warn('Текущий диалог не загружен, ничего не делаем');
        return;
    }
    
    if (state.count < 0) {
        console.warn(`Отрицательное значение count (${state.count}), устанавливаем в 0`);
        state.count = 0;
    }
    
    // ВАЖНОЕ ИЗМЕНЕНИЕ: Не завершаем диалог автоматически при достижении последней строки
    // Вместо этого просто проверяем, что мы не вышли за пределы массива
    if (state.count >= state.currentDialogue.conversations.length) {
        console.log(`Count (${state.count}) превышает длину диалога (${state.currentDialogue.conversations.length}), корректируем`);
        state.count = state.currentDialogue.conversations.length - 1;
        return;
    }
    
    // Получаем текущую строку диалога
    let conversation = state.currentDialogue.conversations[state.count];
    console.log(`Текущая строка диалога (${state.count}):`, conversation);
    
    // Обработка ветвления диалога
    if (conversation && typeof conversation === 'object' && conversation.choiceId && !conversation.hasChoice) {
        handleBranchingDialog(conversation);
        return;
    }
    
    // Очищаем текст перед началом анимации
    $('#text').text('');
    
    // Обработка диалога с выбором (новый формат)
    if (conversation && typeof conversation === 'object' && !Array.isArray(conversation) && conversation.hasChoice) {
        handleChoiceDialog(conversation);
        return;
    }
    
    // Обработка диалога с выбором (старый формат)
    if (conversation && Array.isArray(conversation) && conversation.length > 3 && conversation[4] && conversation[4].hasChoice) {
        handleOldFormatChoiceDialog(conversation);
        return;
    }
    
    // Простая строка диалога (без выбора)
    if (conversation) {
        handleSimpleDialog(conversation);
    } else {
        // Если строк больше нет, завершаем диалог
        endTransmission();
    }
}

/**
 * Обработка ветвления диалога
 * @param {Object} conversation - Текущая строка диалога
 */
function handleBranchingDialog(conversation) {
    console.log("Обработка ветвления диалога", conversation);
    
    const frequency = getCurrentFrequency();
    const userChoicesForFreq = state.userChoices[frequency] || [];
    
    // Ищем сохраненный выбор
    let selectedOption = null;
    for (const choice of userChoicesForFreq) {
        if (choice.choice_id === conversation.choiceId) {
            selectedOption = choice.option_id;
            console.log(`Найден выбор: ${choice.choice_id} -> ${selectedOption}`);
            break;
        }
    }
    
    console.log(`Обработка ветвления для выбора: ${conversation.choiceId}, выбранная опция: ${selectedOption}`);
    
    if (selectedOption && conversation.responses && conversation.responses[selectedOption]) {
        const nextLines = conversation.responses[selectedOption];
        console.log(`Выбрана ветка для опции ${selectedOption}, содержит ${nextLines.length} строк`);
        
        if (nextLines && nextLines.length > 0) {
            // Заменяем текущую строку на первую строку выбранного ответа
            const firstLineOfBranch = nextLines[0]; 
            
            // Добавляем остальные строки после текущей позиции
            const remainingLines = nextLines.slice(1);
            state.currentDialogue.conversations.splice(state.count + 1, 0, ...remainingLines);
            
            console.log(`Добавлены строки ветвления: ${remainingLines.length}`);
            console.log(`Обновленная длина диалога: ${state.currentDialogue.conversations.length}`);
            
            // Очищаем текст перед началом анимации
            $('#text').text('');
            
            // Теперь вместо обработки первой строки прямо здесь, 
            // мы заменяем текущую строку и вызываем showNextLine()
            state.currentDialogue.conversations[state.count] = firstLineOfBranch;
            
            // Сбрасываем флаг завершения передачи на случай, если он был установлен
            state.isTransmissionEnded = false;
            
            console.log("Запускаем showNextLine() для показа первой строки ветки");
            
            // Запускаем показ первой строки ветвления
            // Это запустит полную анимацию с печатью текста
            showNextLine();
            
            // ВАЖНО: возвращаемся из функции, чтобы не выполнять дальнейший код
            return;
        } else {
            console.warn(`Выбрана пустая ветка для опции ${selectedOption}`);
            // Если ветка пустая, просто пропускаем эту строку
            state.count++;
            showNextLine();
            return;
        }
    } else {
        // Если выбор не найден или соответствующей ветки нет, используем первую доступную ветку
        console.warn(`Выбор не найден для: ${conversation.choiceId} или нет соответствующего ответа`);
        
        const firstOptionKey = Object.keys(conversation.responses)[0];
        if (firstOptionKey && conversation.responses[firstOptionKey]) {
            console.log(`Используем первую доступную ветку: ${firstOptionKey}`);
            const nextLines = conversation.responses[firstOptionKey];
            
            if (nextLines && nextLines.length > 0) {
                // Заменяем текущую строку на первую строку первого доступного ответа
                const firstLineOfBranch = nextLines[0];
                
                // Добавляем остальные строки после текущей позиции
                const remainingLines = nextLines.slice(1);
                state.currentDialogue.conversations.splice(state.count + 1, 0, ...remainingLines);
                
                // Очищаем текст перед началом анимации
                $('#text').text('');
                
                // Вместо обработки первой строки прямо здесь,
                // мы заменяем текущую строку и вызываем showNextLine()
                state.currentDialogue.conversations[state.count] = firstLineOfBranch;
                
                // Сбрасываем флаг завершения передачи на случай, если он был установлен
                state.isTransmissionEnded = false;
                
                console.log("Запускаем showNextLine() для показа первой строки ветки");
                
                // Запускаем показ первой строки ветвления через showNextLine
                showNextLine();
                
                // ВАЖНО: возвращаемся из функции, чтобы не выполнять дальнейший код
                return;
            } else {
                // Если первая ветка пустая, просто пропускаем эту строку
                state.count++;
                showNextLine();
                return;
            }
        } else {
            // Если нет ни одной ветки, просто пропускаем эту строку
            state.count++;
            showNextLine();
            return;
        }
    }
}

/**
 * Обработка диалога с выбором (новый формат)
 * @param {Object} conversation - Текущая строка диалога
 */
function handleChoiceDialog(conversation) {
    const speaker = conversation.speaker || 'Система';
    const text = conversation.text || '';
    const image = conversation.image;
    const fakeName = conversation.fakeName || speaker;
    
    // Находим индекс текущего говорящего персонажа
    let speakerIndex = findSpeakerIndex(speaker);
    
    // Определяем и устанавливаем изображение для текущей реплики
    const characterImage = getCharacterImage(image, speakerIndex);
    updateCharacterDisplay(speakerIndex, characterImage);
    
    // Получаем голос персонажа
    const characterVoice = getCharacterVoice(speakerIndex);
    
    // Проверяем, был ли уже сделан выбор для этого диалога
    const frequency = getCurrentFrequency();
    const userChoicesForFreq = state.userChoices[frequency] || [];
    const existingChoice = userChoicesForFreq.find(choice => choice.choice_id === conversation.choiceId);
    
    if (existingChoice) {
        // Если выбор уже был сделан, пропускаем строку с выбором и показываем следующую
        console.log(`Найден существующий выбор: ${existingChoice.choice_id}, переходим к следующей строке`);
        state.currentChoiceId = existingChoice.choice_id;
        state.count++;
        showNextLine();
        return;
    }
    
    // Если выбор еще не был сделан, показываем опции
    // Сначала отображаем текст с типографикой
    typeText(
        text,
        $('#text'), 
        characterVoice,
        fakeName,
        () => {
            // После завершения анимации текста показываем варианты выбора
            showChoiceOptions(conversation.choiceId, conversation.options);
            
            // НЕ увеличиваем счетчик здесь, так как это сделает handleChoiceSelection
            
            // ВАЖНОЕ ИЗМЕНЕНИЕ: НЕ сохраняем прогресс после показа вариантов выбора
            // Прогресс будет сохранен после выбора пользователя в функции handleChoiceSelection
            
            // Сохраняем ID выбора для дальнейшего ветвления
            state.currentChoiceId = conversation.choiceId;
        }
    );
}

/**
 * Обработка диалога с выбором (старый формат)
 * @param {Object} conversation - Текущая строка диалога
 */
function handleOldFormatChoiceDialog(conversation) {
    const speaker = conversation[0] || 'Система';
    const text = conversation[1] || '';
    const image = conversation[2];
    const fakeName = conversation[3] || speaker;
    
    // Находим индекс текущего говорящего персонажа
    let speakerIndex = findSpeakerIndex(speaker);
    
    // Определяем и устанавливаем изображение
    const characterImage = getCharacterImage(image, speakerIndex);
    updateCharacterDisplay(speakerIndex, characterImage);
    
    // Получаем голос персонажа
    const characterVoice = getCharacterVoice(speakerIndex);
    
    // Проверяем, был ли уже сделан выбор
    // Проверяем, был ли уже сделан выбор
    const frequency = getCurrentFrequency();
    const userChoicesForFreq = state.userChoices[frequency] || [];
    const existingChoice = userChoicesForFreq.find(choice => choice.choice_id === conversation[4].choiceId);
    
    if (existingChoice) {
        // Если выбор уже был сделан, пропускаем строку с выбором
        console.log(`Найден существующий выбор: ${existingChoice.choice_id}, переходим к следующей строке`);
        state.currentChoiceId = existingChoice.choice_id;
        state.count++;
        showNextLine();
        return;
    }
    
    // Сначала отображаем текст с типографикой
    typeText(
        text,
        $('#text'), 
        characterVoice,
        fakeName,
        () => {
            showChoiceOptions(conversation[4].choiceId, conversation[4].options);
            
            // ВАЖНОЕ ИЗМЕНЕНИЕ: НЕ сохраняем прогресс после показа вариантов выбора
            // Прогресс будет сохранен после выбора пользователя в функции handleChoiceSelection
            
            // Сохраняем ID выбора для дальнейшего ветвления
            state.currentChoiceId = conversation[4].choiceId;
        }
    );
}

/**
 * Показать варианты выбора
 * @param {string} choiceId - ID выбора
 * @param {Array} options - Варианты выбора
 */
function showChoiceOptions(choiceId, options) {
    // Создаем контейнер для вариантов ответа
    const choiceContainer = document.createElement('div');
    choiceContainer.className = 'choice-container';
	
	// Помечаем контейнер текста как активный с выбором
    $('#text-con').addClass('choices-active');
    
    // Создаем кнопки для каждого варианта
    options.forEach(option => {
        const button = document.createElement('button');
        button.className = 'choice-button';
        button.textContent = option.text;
        button.dataset.choiceId = option.id;
        
        // Добавляем обработчик клика
        button.addEventListener('click', () => handleChoiceSelection(choiceId, option));
        
        choiceContainer.appendChild(button);
    });
    
    // Добавляем контейнер с кнопками выбора в DOM
    document.getElementById('text-con').appendChild(choiceContainer);
}

/**
 * Модификация функции обработки строки диалога
 * @param {Object|Array} conversation - Строка диалога
 */
function handleSimpleDialog(conversation) {
    // Очищаем текст перед началом анимации
    $('#text').text('');
    
    if (Array.isArray(conversation)) {
        processArrayDialogLine(conversation);
    } else if (typeof conversation === 'object') {
        processObjectDialogLine(conversation);
    } else {
        // Неизвестный формат - просто перейдем к следующей строке
        console.warn('Неизвестный формат диалога:', conversation);
        state.count++;
        
        // Сохраняем обновленный прогресс после увеличения счетчика
        const currentFrequency = getCurrentFrequency();
        saveDialogueProgress(currentFrequency, false);
        
        if (state.count >= state.currentDialogue.conversations.length) {
            console.log('Достигнут конец диалога, но ждем клика пользователя для завершения');
        } else {
            // Если не вышел, показываем следующую строку
            showNextLine();
        }
    }
}

/**
 * Обработка строки диалога в формате массива
 * @param {Array} conversation - Строка диалога
 */
function processArrayDialogLine(conversation) {
    // Находим индекс текущего говорящего персонажа
    let speakerIndex = findSpeakerIndex(conversation[0]);
    
    // Определяем имя персонажа (реальное или фейковое)
    let characterName = conversation[3] || conversation[0] || 'Система';
    
    // Определяем изображение для текущей реплики
    let characterImage = getCharacterImage(conversation[2], speakerIndex);
    
    // Устанавливаем изображение персонажа
    updateCharacterDisplay(speakerIndex, characterImage);
    
    // Получаем голос персонажа
    let characterVoice = getCharacterVoice(speakerIndex);
    
    // Проверяем наличие выбора после текущей строки
    const hasChoiceAfter = conversation.length > 4 && conversation[4] && conversation[4].hasChoice;
    
    // НОВЫЙ КОД: Проверка на наличие маркеров глюков
    let dialogText = conversation[1] || '';
    checkAndActivateGlitchEffects(dialogText);
    
    // Анимация печати текста
    typeText(
        dialogText, 
        $('#text'), 
        characterVoice,
        characterName,
        () => {
            // Если после текущей строки есть выбор, сохраняем ID выбора
            if (hasChoiceAfter) {
                state.currentChoiceId = conversation[4].choiceId;
            } else {
                // Увеличиваем счетчик для следующей строки
                state.count++;
                
                // Сохраняем обновленный прогресс ТОЛЬКО после завершения анимации
                const currentFrequency = getCurrentFrequency();
                saveDialogueProgress(currentFrequency, false);
            }
        }
    );
}

/**
 * Обработка строки диалога в формате объекта
 * @param {Object} conversation - Строка диалога
 */
function processObjectDialogLine(conversation) {
    // Находим индекс текущего говорящего персонажа
    let speakerIndex = findSpeakerIndex(conversation.speaker);
    
    // Определяем имя персонажа (реальное или фейковое)
    let characterName = conversation.fakeName || conversation.speaker || 'Система';
    
    // Определяем изображение для текущей реплики
    let characterImage = getCharacterImage(conversation.image, speakerIndex);
    
    // Устанавливаем изображение персонажа
    updateCharacterDisplay(speakerIndex, characterImage);
    
    // Воспроизведение голоса персонажа
    let characterVoice = getCharacterVoice(speakerIndex);
    
    // НОВЫЙ КОД: Проверка на наличие маркеров глюков
    let dialogText = conversation.text || '';
    checkAndActivateGlitchEffects(dialogText);
    
    // Анимация печати текста
    typeText(
        dialogText,
        $('#text'), 
        characterVoice,
        characterName,
        () => {
            // Увеличиваем счетчик для следующей строки
            state.count++;
            
            // Сохраняем обновленный прогресс ТОЛЬКО после завершения анимации
            const currentFrequency = getCurrentFrequency();
            saveDialogueProgress(currentFrequency, false);
        }
    );
}

/**
 * Найти индекс говорящего персонажа
 * @param {string} speaker - Имя говорящего
 * @returns {number} - Индекс персонажа
 */
function findSpeakerIndex(speaker) {
    let speakerIndex = -1;
    if (speaker && state.currentDialogue.characters) {
        speakerIndex = state.currentDialogue.characters.findIndex(
            char => char.name === speaker
        );
    }
    
    // Если персонаж не найден, используем индекс по умолчанию
    return speakerIndex === -1 ? 0 : speakerIndex;
}

/**
 * Получить изображение персонажа
 * @param {string} image - Путь к изображению
 * @param {number} speakerIndex - Индекс персонажа
 * @returns {string} - Путь к изображению
 */
function getCharacterImage(image, speakerIndex) {
    if (image) return getAssetUrl(image);
    
    if (speakerIndex >= 0 && 
        state.currentDialogue.characters && 
        speakerIndex < state.currentDialogue.characters.length) {
        const charImage = state.currentDialogue.characters[speakerIndex].image;
        return charImage ? getAssetUrl(charImage) : getAssetUrl('assets/images/portraits/static.gif');
    }
    
    return getAssetUrl('assets/images/portraits/static.gif');
}

/**
 * Получить голос персонажа
 * @param {number} speakerIndex - Индекс персонажа
 * @returns {Audio|null} - Аудио-объект
 */
function getCharacterVoice(speakerIndex) {
    if (speakerIndex >= 0 && 
        state.currentDialogue.characters && 
        speakerIndex < state.currentDialogue.characters.length) {
        const char = state.currentDialogue.characters[speakerIndex];
        return {
            audio: char.voice ? new Audio(getAssetUrl(char.voice)) : null,
            mode: char.voiceMode || 'none'
        };
    }
    return { audio: null, mode: 'none' };
}

/**
 * Получить окно персонажа (1 или 2)
 * @param {number} speakerIndex - Индекс персонажа
 * @returns {number} - Номер окна (1 или 2)
 */
function getCharacterWindow(speakerIndex) {
    if (speakerIndex >= 0 && 
        state.currentDialogue.characters && 
        speakerIndex < state.currentDialogue.characters.length) {
        const char = state.currentDialogue.characters[speakerIndex];
        // Если указан параметр window, используем его
        if (char.window) {
            return parseInt(char.window) || 1;
        }
    }
    // По умолчанию: нечетные индексы -> окно 1, четные -> окно 2
    return speakerIndex % 2 === 0 ? 1 : 2;
}

/**
 * Получить всех персонажей для указанного окна
 * @param {number} windowNum - Номер окна (1 или 2)
 * @returns {Array} - Массив индексов персонажей
 */
function getCharactersForWindow(windowNum) {
    if (!state.currentDialogue.characters) return [];
    
    return state.currentDialogue.characters
        .map((char, index) => ({ char, index }))
        .filter(({ char, index }) => {
            const charWindow = char.window ? parseInt(char.window) : (index % 2 === 0 ? 1 : 2);
            return charWindow === windowNum;
        })
        .map(({ index }) => index);
}

/**
 * Обновить отображение персонажа
 * Сохраняет портрет в окне после первой реплики
 * @param {number} speakerIndex - Индекс персонажа
 * @param {string} image - Путь к изображению
 */
function updateCharacterDisplay(speakerIndex, image) {
    const speakerWindow = getCharacterWindow(speakerIndex);
    
    if (speakerWindow === 1) {
        // Говорящий в окне 1 (слева) - активно
        $('#char-1').css('background-image', `url(${image})`);
        $('#char-1 .overlay').css('opacity', '0.7');
        
        // Сохраняем портрет для окна 1
        state.lastPortrait.window1 = image;
        
        // Окно 2 - показываем последний портрет или оставляем как есть
        $('#char-2 .overlay').css('opacity', '0.3');
    } else {
        // Говорящий в окне 2 (справа) - активно
        $('#char-2').css('background-image', `url(${image})`);
        $('#char-2 .overlay').css('opacity', '0.7');
        
        // Сохраняем портрет для окна 2
        state.lastPortrait.window2 = image;
        
        // Окно 1 - показываем последний портрет или оставляем как есть
        $('#char-1 .overlay').css('opacity', '0.3');
    }
}

/**
 * Инициализировать портреты персонажей при старте диалога
 * Показывает static.gif во всех окнах, сбрасывает сохраненные портреты
 */
function initializeCharacterPortraits() {
    const staticImage = getAssetUrl('assets/images/portraits/static.gif');
    
    state.lastPortrait.window1 = null;
    state.lastPortrait.window2 = null;
    
    $('#char-1, #char-2').css('background-image', `url(${staticImage})`);
    $('.overlay').css('opacity', '0.3');
}

/**
 * Завершение передачи
 */
function endTransmission() {
    console.log('Завершение передачи');
    
    if (state.currentVoiceline) {
        state.currentVoiceline.pause();
        state.currentVoiceline = null;
    }
    
    const currentFrequency = getCurrentFrequency();
    
    // Очищаем текст и имя говорящего
    $('#text').text('*КОНЕЦ ПЕРЕДАЧИ*');
    $('#c-char').text('');
    $('#repeat-transmission').addClass('hidden');
    
    // Уменьшаем яркость персонажей и заменяем их изображения на статику
    $('.overlay').css('opacity', '0.3');
    $('#char-1, #char-2').css('background-image', `url(${getAssetUrl('assets/images/portraits/static.gif')})`);
    
    // Устанавливаем флаг завершения передачи
    state.isTransmissionEnded = true;
    
    // Увеличиваем счетчик прослушиваний для текущей частоты
    if (!state.repeatCount[currentFrequency]) {
        state.repeatCount[currentFrequency] = 1;
    } else {
        state.repeatCount[currentFrequency]++;
    }
    
    // Сохраняем обновленные счетчики
    saveRepeatCounts();
    
    // Проверяем количество прослушиваний
    // Изменение: показываем кнопку повтора только если диалог прослушан ровно один раз
    if (state.repeatCount[currentFrequency] === 0) {
        // Если пользователь прослушал диалог ровно один раз, показываем кнопку повтора
        $('#repeat-transmission').removeClass('hidden');
        console.log(`Диалог на частоте ${currentFrequency} прослушан ${state.repeatCount[currentFrequency]} раз, показываем кнопку повтора`);
    } else {
        // Иначе скрываем кнопку повтора
        $('#repeat-transmission').addClass('hidden');
        console.log(`Диалог на частоте ${currentFrequency} прослушан ${state.repeatCount[currentFrequency]} раз, скрываем кнопку повтора`);
    }
    
    // Скрываем кнопку старта
    $('#start-transmission').addClass('hidden');
    
    // Сохраняем прогресс как завершенный
    saveDialogueProgress(currentFrequency, true);
    
    // Логируем состояние диалога
    logDialogueState();
}

/**
 * Восстановление позиции в диалоге
 */
function restoreDialoguePosition() {
    // Восстанавливаем диалог с сохраненной позиции
    const currentFrequency = getCurrentFrequency();
    state.currentDialogue = games[state.currentGame]['dialogues'][currentFrequency];
    
    console.log(`Восстанавливаем диалог с позиции ${state.count} для частоты ${currentFrequency}`);
    
    if (state.currentDialogue) {
        // Проверяем, есть ли диалог на этой позиции
        if (state.count >= state.currentDialogue.conversations.length) {
            console.log(`Count (${state.count}) превышает или равен длине диалога (${state.currentDialogue.conversations.length}), корректируем`);
            
            // Если count равен длине, это может означать, что диалог завершен
            if (state.count === state.currentDialogue.conversations.length) {
                state.count = state.currentDialogue.conversations.length - 1;
                console.log(`Показываем последнюю строку диалога (count=${state.count})`);
            } else {
                // Если count больше длины, сбрасываем до начала
                state.count = 0;
                console.log(`Сбрасываем диалог на начало (count=${state.count})`);
            }
        }
        
        // Проверяем, что count все еще в допустимом диапазоне после коррекции
        if (state.count >= 0 && state.count < state.currentDialogue.conversations.length) {
            // Показываем персонажей
            initializeCharacterPortraits();
            
            // Очищаем текст перед началом
            $('#text').text('');
            $('#c-char').text('');
            
            // Скрываем кнопку старта
            $('#start-transmission').addClass('hidden');
            
            // Явно устанавливаем флаг незавершенного диалога
            state.isTransmissionEnded = false;
            
            // Показываем текущую строку диалога с текущим count
            showNextLine();
        } else {
            // Если индекс все еще вне диапазона, сбрасываем счетчик
            console.warn(`Невозможно восстановить диалог: count=${state.count} вне диапазона после коррекции, длина=${state.currentDialogue.conversations.length}`);
            state.count = 0;
            $('#text').text('*ОШИБКА ВОССТАНОВЛЕНИЯ ДИАЛОГА*');
            $('#c-char').text('');
            
            // Показываем кнопку старта
            $('#start-transmission').removeClass('hidden');
            $('#start-transmission').find('.start-link').text('Начать передачу');
        }
    } else {
        console.error(`Не удалось восстановить диалог для частоты ${currentFrequency}`);
        // Если диалог не найден
        $('#text').text('*ДИАЛОГ НЕ НАЙДЕН*');
        $('#c-char').text('');
        
        // Показываем кнопку старта
        $('#start-transmission').removeClass('hidden');
        $('#start-transmission').find('.start-link').text('Начать передачу');
    }
}


/**
 * Обработчик выбора пользователя
 * @param {string} choiceId - ID выбора
 * @param {Object} selectedOption - Выбранная опция
 */
function handleChoiceSelection(choiceId, selectedOption) {
    console.log(`Обработка выбора: choiceId=${choiceId}, selectedOption=`, selectedOption);
    
    // Проверяем наличие choiceId и selectedOption
    if (!choiceId || !selectedOption) {
        console.error('Недостаточно данных для обработки выбора:', {choiceId, selectedOption});
        return;
    }
	
	// Убираем пометку активного выбора
    $('#text-con').removeClass('choices-active');

    // Блокируем повторные клики во время обработки выбора
    $('#text-con').addClass('processing-choice');

    // Сохраняем выбор пользователя
    const currentFrequency = getCurrentFrequency();
    
    // Сохраняем в локальный объект
    if (!state.userChoices[currentFrequency]) {
        state.userChoices[currentFrequency] = [];
    }
    
    // Создаем объект выбора
    const choiceObject = {
        choice_id: choiceId,
        option_id: selectedOption.id,
        choice_text: selectedOption.text
    };
    
    // Проверяем, не сделан ли уже этот выбор
    const existingChoiceIndex = state.userChoices[currentFrequency].findIndex(
		choice => choice.choice_id === choiceId
	);

	if (existingChoiceIndex >= 0) {
		// Если выбор уже сделан, обновляем его
		state.userChoices[currentFrequency][existingChoiceIndex] = choiceObject;
	} else {
		// Иначе добавляем новый выбор
		state.userChoices[currentFrequency].push(choiceObject);
	}

	console.log(`Обновлены локальные выборы:`, state.userChoices[currentFrequency]);

	try {
		// Пытаемся сохранить выбор на сервере, но продолжаем независимо от результата
		saveUserChoice(currentFrequency, choiceId, selectedOption.id, selectedOption.text)
			.catch(error => {
				console.error('Ошибка при сохранении выбора на сервере:', error);
				// Не прерываем выполнение, даже если сохранение не удалось
			});
	} catch (error) {
		console.error('Ошибка при попытке сохранить выбор:', error);
		// Продолжаем выполнение даже при ошибке
	}

	// Удаляем контейнер с кнопками выбора
	const choiceContainer = document.querySelector('.choice-container');
	if (choiceContainer) {
		choiceContainer.remove();
	}

	// Устанавливаем currentChoiceId для дальнейшего ветвления
	state.currentChoiceId = choiceId;
	state.selectedOptionId = selectedOption.id;

	// Увеличиваем счетчик и готовимся показать следующую строку
	state.count++;

	// Сохраняем прогресс после выбора с обновленным count
	saveDialogueProgress(currentFrequency, false);

	// Логируем состояние перед переходом к следующей строке
	logDialogueState();

	// Разблокируем интерфейс
	setTimeout(() => {
		$('#text-con').removeClass('processing-choice');
		
		// Переходим к следующей строке диалога
		showNextLine();
	}, 100); // Небольшая задержка для завершения анимаций
}

/**
 * Сохранение выбора пользователя на сервере
 * @param {string} frequency - Частота
 * @param {string} choiceId - ID выбора
 * @param {string} optionId - ID опции
 * @param {string} optionText - Текст опции
 * @returns {Promise} - Промис с результатом запроса
 */
async function saveUserChoice(frequency, choiceId, optionId, optionText) {
    try {
        console.log(`Сохранение выбора: frequency=${frequency}, choiceId=${choiceId}, option=${optionId} (${optionText})`);
        
        // Проверка входных данных
        if (!frequency || !choiceId || !optionId) {
            console.error('Недостаточно данных для сохранения выбора', { frequency, choiceId, optionId });
            return;
        }
        
        // Создаем объект данных для отправки
        const requestData = {
            frequency: frequency,
            choiceId: choiceId,
            optionId: optionId,
            choiceText: optionText || 'Текст не указан'
        };
        
        console.log('Отправка данных на сервер:', JSON.stringify(requestData));
        
        // Отправляем запрос на сервер
        const response = await fetch(`${API_URL}/user-choice`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData),
            credentials: 'include'
        });
        
        // Обрабатываем ответ сервера
        if (!response.ok) {
            // В случае ошибки пытаемся получить текст ошибки
            let errorText = '';
            try {
                errorText = await response.text();
            } catch (e) {
                errorText = 'Не удалось получить текст ошибки';
            }
            
            console.error(`Ошибка сервера: ${response.status} ${response.statusText}`, errorText);
            
            // Не выбрасываем исключение, чтобы не прерывать выполнение диалога
            return {
                success: false,
                error: `Ошибка сервера: ${response.status}`
            };
        }
        
        // Пытаемся разобрать JSON-ответ
        let data;
        try {
            data = await response.json();
        } catch (e) {
            console.warn('Не удалось разобрать JSON-ответ:', e);
            data = { success: true, warning: 'Некорректный JSON-ответ' };
        }
        
        console.log('Выбор сохранен успешно:', data);
        return {
            success: true,
            data: data
        };
    } catch (error) {
        console.error('Ошибка при сохранении выбора:', error);
        // Возвращаем объект с информацией об ошибке, но не прерываем выполнение
        return {
            success: false,
            error: error.message || 'Неизвестная ошибка'
        };
    }
}

// Флаг для отслеживания активного сохранения
let isSavingProgress = false;
let lastSavedPosition = -1;
let lastSavedFrequency = '';

/**
 * Сохранение прогресса диалога
 * @param {string} frequency - Частота
 * @param {boolean} completed - Флаг завершения диалога
 */
async function saveDialogueProgress(frequency, completed = false) {
    // Если прогресс не изменился, не делаем запрос
    if (lastSavedPosition === state.count && lastSavedFrequency === frequency && !completed) {
        console.log(`Прогресс диалога не изменился (count=${state.count}, frequency=${frequency}), пропускаем сохранение`);
        return;
    }
    
    // Если уже идет сохранение, отменяем новый запрос
    if (isSavingProgress) {
        console.log('Уже идет сохранение прогресса, пропускаем');
        return;
    }

    // Устанавливаем флаг активного сохранения
    isSavingProgress = true;

    try {
        // Если диалог уже завершен, не перезаписываем его как незавершенный
        if (!completed) {
            // Проверяем, не завершен ли диалог уже в базе данных
            const progressResponse = await fetch(`${API_URL}/dialogue-progress`, {
                credentials: 'include'
            });
            
            if (progressResponse.ok) {
                const data = await progressResponse.json();
                const dialogueProgress = (data.progress || []).find(p => p.frequency === frequency);
                
                if (dialogueProgress && dialogueProgress.completed) {
                    console.log(`Диалог для частоты ${frequency} уже отмечен как завершенный, не обновляем прогресс`);
                    isSavingProgress = false; // Сбрасываем флаг
                    return;
                }
            }
        }
        
        // Получаем текущий диалог для проверки границ
        const currentDialogue = games[state.currentGame]['dialogues'][frequency];
        
        // Сохраняем текущую позицию
        let currentPosition = state.count;
        
        // Проверяем, не выходит ли позиция за границы диалога
        if (currentDialogue && currentPosition >= currentDialogue.conversations.length) {
            console.log(`Позиция ${currentPosition} выходит за границы диалога длиной ${currentDialogue.conversations.length}, корректируем`);
            currentPosition = currentDialogue.conversations.length - 1;
            
            // ВАЖНОЕ ИЗМЕНЕНИЕ: НЕ устанавливаем completed в true автоматически,
            // даже если мы находимся на последней строке.
            // completed должен быть установлен только когда пользователь явно завершил диалог
        }
        
        console.log(`Сохраняем прогресс диалога: частота=${frequency}, позиция=${currentPosition}, завершен=${completed}`);
        
        const response = await fetch(`${API_URL}/dialogue-progress`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                frequency,
                progress: currentPosition,
                completed,
                lastLine: currentPosition // Убедимся, что lastLine всегда соответствует текущей позиции
            }),
            credentials: 'include'
        });
        
        if (!response.ok) {
            throw new Error('Ошибка при сохранении прогресса');
        }
        
        const data = await response.json();
        console.log(`Прогресс диалога сохранен успешно:`, data);
        
        // Запоминаем последний сохраненный прогресс
        lastSavedPosition = currentPosition;
        lastSavedFrequency = frequency;
        
        // Если диалог явно завершен через параметр completed, обновляем интерфейс
        if (completed) {
            // ИЗМЕНЕНО: Показываем кнопку повтора только если это первое завершение диалога
            if (!state.repeatCount[frequency] || state.repeatCount[frequency] === 0) {
                $('#repeat-transmission').removeClass('hidden');
            } else {
                $('#repeat-transmission').addClass('hidden');
            }
            $('#start-transmission').addClass('hidden');
            state.isTransmissionEnded = true;
        }
    } catch (error) {
        console.error('Ошибка при сохранении прогресса:', error);
    } finally {
        // Сбрасываем флаг в любом случае, даже при ошибке
        isSavingProgress = false;
    }
}

/**
 * Проверка текста диалога на наличие маркеров глюков и активация соответствующих эффектов
 * @param {string} text - Текст диалога
 * @returns {string} - Очищенный от маркеров текст
 */
function checkAndActivateGlitchEffects(text) {
    // Если текущая частота не PER, просто возвращаем текст
    const currentFrequency = getCurrentFrequency();
    if (currentFrequency !== 'PER') {
        return text;
    }
    
    // Маркеры глюков и соответствующие им действия
    const glitchMarkers = [
        {
            marker: '[GLITCH_START]',
            action: () => activateDialogueGlitch('per-initial')
        },
        {
            marker: '[GLITCH_STRONG]',
            action: () => activateDialogueGlitch('per-strong')
        },
        {
            marker: '[GLITCH_CRITICAL]',
            action: () => activateDialogueGlitch('per-critical')
        },
        {
            marker: '[GLITCH_END]',
            action: () => clearGlitchEffects()
        }
    ];
    
    // Очищенный текст
    let cleanText = text;
    
    // Проверяем каждый маркер
    glitchMarkers.forEach(({marker, action}) => {
        if (text.includes(marker)) {
            action();
            // Удаляем маркер из текста
            cleanText = cleanText.replace(marker, '');
        }
    });
    
    return cleanText;
}

/**
 * Извлечение пауз из текста
 * Формат паузы: [2s], [1.5s], [0.5s] и т.д.
 * @param {string} text - Исходный текст
 * @returns {Object} - Объект с текстом без пауз и массивом пауз
 */
function extractPauses(text) {
    const pauses = [];
    let cleanText = '';
    let currentIndex = 0;
    
    const pauseRegex = /\[(\d+\.?\d*)s\]/g;
    let match;
    let lastIndex = 0;
    
    while ((match = pauseRegex.exec(text)) !== null) {
        // Добавляем текст до паузы
        const textBefore = text.substring(lastIndex, match.index);
        cleanText += textBefore;
        
        // Записываем паузу для позиции после добавленного текста
        const pauseDuration = parseFloat(match[1]);
        pauses[cleanText.length] = pauseDuration;
        
        lastIndex = match.index + match[0].length;
    }
    
    // Добавляем оставшийся текст
    cleanText += text.substring(lastIndex);
    
    return { text: cleanText, pauses };
}

/**
 * Модифицированная функция typeText для поддержки эффектов глюков
 * @param {string} text - Текст для вывода
 * @param {jQuery} element - Элемент для вывода текста
 * @param {Audio} characterVoice - Голос персонажа
 * @param {string} characterName - Имя персонажа
 * @param {function} onComplete - Функция для вызова после завершения
 */
function typeText(text, element, characterVoice, characterName, onComplete = null) {
    if (!text) text = '';
    if (!characterName) characterName = 'Система';
    
    const voiceData = characterVoice || { audio: null, mode: 'none' };
    const voiceAudio = voiceData.audio;
    const voiceMode = voiceData.mode || 'none';
    
    const cleanText = checkAndActivateGlitchEffects(text);
    const { text: textWithoutPauses, pauses } = extractPauses(cleanText);
    
    console.log(`Печать текста: "${textWithoutPauses.substring(0, 30)}..." от персонажа "${characterName}", режим звука: ${voiceMode}`);
    
    $('#c-char').text(characterName + ':');
    $('#text-con').addClass('typing-in-progress');
    element.text('');
    
    if (!textWithoutPauses) {
        $('#text-con').removeClass('typing-in-progress');
        if (onComplete) onComplete();
        return;
    }
    
    let i = 0;
    let isTyping = true;
    
    if (state.typingTimeout) {
        clearTimeout(state.typingTimeout);
    }
    
    if (state.currentVoiceline) {
        state.currentVoiceline.pause();
        state.currentVoiceline = null;
    }
    
    if (voiceMode === 'voiceline' && voiceAudio) {
        try {
            const voicelineClone = voiceAudio.cloneNode();
            voicelineClone.volume = 0.8;
            state.currentVoiceline = voicelineClone;
            voicelineClone.play().catch(err => console.warn('Не удалось воспроизвести озвучку:', err));
        } catch (e) {
            console.warn('Ошибка при воспроизведении озвучки:', e);
        }
    }
    
    function typing() {
        const isGlitchActive = glitchEffects.isActive && getCurrentFrequency() === 'PER';
        
        if (i < textWithoutPauses.length && $('#text-con').hasClass('typing-in-progress')) {
            const pauseBefore = pauses[i];
            if (pauseBefore > 0) {
                state.typingTimeout = setTimeout(() => {
                    processCharacter();
                }, pauseBefore * 1000);
                return;
            }
            
            processCharacter();
        } else {
            isTyping = false;
            $('#text-con').removeClass('typing-in-progress');
            element.text(textWithoutPauses);
            if (onComplete) onComplete();
        }
    }
    
    function processCharacter() {
        element.text(textWithoutPauses.slice(0, i + 1));
        
        let delay = Math.random() * 40 + 30;
        
        const isGlitchActive = glitchEffects.isActive && getCurrentFrequency() === 'PER';
        
        if (isGlitchActive) {
            if (Math.random() < (glitchEffects.intensity / 50)) {
                delay += Math.random() * 300;
            }
            
            if (Math.random() < (glitchEffects.intensity / 40)) {
                const originalText = element.text();
                const scrambledText = scrambleText(originalText);
                element.text(scrambledText);
                
                setTimeout(() => {
                    if (i < textWithoutPauses.length) {
                        element.text(textWithoutPauses.slice(0, i + 1));
                    }
                }, 50 + Math.random() * 150);
            }
        }
        
        const punctuationMarks = ['.', ',', '!', '?', ':', ';'];
        
        if (voiceMode === 'typing' && voiceAudio && textWithoutPauses[i] !== ' ' && textWithoutPauses[i] !== '\n') {
            try {
                const voiceClone = voiceAudio.cloneNode();
                voiceClone.currentTime = 0;
                
                let volume = 0.03;
                
                if (punctuationMarks.includes(textWithoutPauses[i])) {
                    volume = 0.015;
                } else if (textWithoutPauses[i] === textWithoutPauses[i].toUpperCase() && textWithoutPauses[i].match(/[A-ZА-Я]/)) {
                    volume = 0.045;
                }
                
                if (isGlitchActive && Math.random() < (glitchEffects.intensity / 30)) {
                    volume *= 2;
                    voiceClone.playbackRate = 0.7 + Math.random() * 0.8;
                }
                
                voiceClone.volume = volume;
                voiceClone.playbackRate = 0.9 + Math.random() * 0.3;
                
                voiceClone.play().catch(err => console.warn('Не удалось воспроизвести звук:', err));
            } catch (e) {
                console.warn('Ошибка при воспроизведении звука:', e);
            }
        }
        
        if (i > 0 && punctuationMarks.includes(textWithoutPauses[i-1])) {
            if (textWithoutPauses[i-1] === '.') {
                delay += 350;
            } else if (textWithoutPauses[i-1] === '!' || textWithoutPauses[i-1] === '?') {
                delay += 300;
            } else if (textWithoutPauses[i-1] === ':' || textWithoutPauses[i-1] === ';') {
                delay += 250;
            } else if (textWithoutPauses[i-1] === ',') {
                delay += 150;
            }
        }
        
        delay *= (0.9 + Math.random() * 0.2);
        
        i++;
        
        state.typingTimeout = setTimeout(typing, delay);
    }
    
    function skipTyping() {
        if (isTyping) {
            clearTimeout(state.typingTimeout);
            element.text(textWithoutPauses);
            isTyping = false;
            $('#text-con').removeClass('typing-in-progress');
            if (state.currentVoiceline) {
                state.currentVoiceline.pause();
                state.currentVoiceline = null;
            }
            if (onComplete) onComplete();
        }
    }
    
    $('#text-con').one('click', skipTyping);
    
    typing();
}


/**
 * Логирование текущего состояния диалога
 */
function logDialogueState() {
    console.group('Текущее состояние диалога');
    const currentFrequency = getCurrentFrequency();
    console.log(`Частота: ${currentFrequency}`);
    console.log(`Позиция (count): ${state.count}`);
    console.log(`Диалог завершен: ${state.isTransmissionEnded}`);
    console.log(`Счетчик повторных прослушиваний: ${state.repeatCount[currentFrequency] || 0}`);
    
    if (state.currentDialogue) {
        console.log(`Всего строк: ${state.currentDialogue.conversations.length}`);
        
        if (state.count < state.currentDialogue.conversations.length) {
            console.log(`Текущая строка:`, state.currentDialogue.conversations[state.count]);
            
            // Добавим информацию о предыдущей и следующей строке для удобства отладки
            if (state.count > 0) {
                console.log(`Предыдущая строка:`, state.currentDialogue.conversations[state.count - 1]);
            }
            
            if (state.count < state.currentDialogue.conversations.length - 1) {
                console.log(`Следующая строка:`, state.currentDialogue.conversations[state.count + 1]);
            }
        } else {
            console.log(`Текущая строка: вне диапазона`);
        }
    } else {
        console.log(`Текущий диалог: не загружен`);
    }
    
    const currentFreq = getCurrentFrequency();
    console.log(`Сохраненные выборы:`, state.userChoices[currentFreq] || []);
    console.groupEnd();
}

// Проверяем доступность API для счетчиков повторений
async function checkRepeatCountsApiAvailability() {
    try {
        const response = await fetch(`${API_URL}/repeat-counts-check`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
            }
        });
        
        if (response.ok) {
            return true;
        }
        return false;
    } catch (error) {
        console.log('API для счетчиков повторений недоступно:', error);
        return false;
    }
}

/**
 * Изменение частоты
 */
function changeFreq() {
    console.log("Изменение частоты");
    
    $('#text-con').removeClass('typing-in-progress');
    
    if (state.currentVoiceline) {
        state.currentVoiceline.pause();
        state.currentVoiceline = null;
    }
    
    $('audio').each(function() {
        this.pause();
        this.currentTime = 0;
    });
    
    // Останавливаем любые таймауты
    if (state.typingTimeout) {
        clearTimeout(state.typingTimeout);
    }
    
    // Удаляем контейнер выбора, если он есть
    const choiceContainer = document.querySelector('.choice-container');
    if (choiceContainer) {
        choiceContainer.remove();
    }

    var id = this.getAttribute("id");
    const oldFreqCount = state.freqCount;
    
    // Функция для поиска следующей доступной частоты
    function findNextAvailableFreq(direction) {
        const freqArray = games[state.currentGame]['frequencies'];
        const totalFreqs = freqArray.length;
        let newFreqCount = state.freqCount;
        let attempts = 0;
        
        // Проверяем максимум totalFreqs попыток, чтобы избежать бесконечного цикла
        while (attempts < totalFreqs) {
            // Вычисляем новый индекс в зависимости от направления
            if (direction === 'next') {
                newFreqCount = (newFreqCount + 1) % totalFreqs;
            } else {
                newFreqCount = (newFreqCount - 1 + totalFreqs) % totalFreqs;
            }
            
            // Получаем частоту на новом индексе
            const newFreq = freqArray[newFreqCount];
            
            // Проверяем доступ к новой частоте
            if (hasAccessToFrequency(newFreq)) {
                return newFreqCount;
            }
            
            attempts++;
        }
        
        // Если не найдено ни одной доступной частоты, возвращаем текущую
        return state.freqCount;
    }
    
    // Определяем направление поиска и находим следующую доступную частоту
    const direction = (id === 'right' || id === 'right_2') ? 'next' : 'prev';
    state.freqCount = findNextAvailableFreq(direction);
    
    // Проверяем, изменилась ли частота
    if (oldFreqCount === state.freqCount) {
        console.log("Частота не изменилась, пропускаем обновление");
        return;
    }
    
    console.log(`Частота изменена: ${games[state.currentGame]['frequencies'][oldFreqCount]} -> ${games[state.currentGame]['frequencies'][state.freqCount]}`);
    
    // Обновляем частоту
    updateFrequencyDisplay();
    
    // Полный сброс диалога
    state.currentDialogue = null;
    state.initialDialogue = null;
    state.count = 0;
    state.isTransmissionEnded = false;
    state.currentChoiceId = null;
    
    // Очищаем текст и имя персонажа
    $('#text').text('');
    $('#c-char').text('');
    
    // Сбрасываем изображения персонажей
    $('#char-1, #char-2').css('background-image', `url(${getAssetUrl('assets/images/portraits/static.gif')})`);
    $('.overlay').css('opacity', '0.3');
    
    // Скрываем кнопки
    $('#repeat-transmission').addClass('hidden');
    
        
    // Инициализируем трансмиссию для новой частоты
    initializeTransmission();
}

/**
 * Создание эффекта полосок индикатора
 */
function createBarEffect() {
    var barWidth = $('#bars-con').children();
    for (var increaseWidth = 1; increaseWidth < (barWidth.length + 1); increaseWidth++) {
        $('#bars-con').children().eq(increaseWidth - 1).css('width', 10 * (barWidth.length - increaseWidth + 1) + '%');
    }
}

/**
 * Анимация для полосок индикатора
 */
function barSignal() {
    var barWidth = $('#bars-con').children();
    var signalCount = barWidth.length;
    var dBar = true;

    function animateBars() {
        if (dBar) {
            signalCount--;
            $('#bars-con').children().eq(signalCount).css('background-color', '#03FB8D');
            if (signalCount === 0) {
                dBar = false;
            }
        } else {
            signalCount++;
            $('#bars-con').children().eq(signalCount).css('background-color', '#397975');
            if (signalCount === barWidth.length) {
                dBar = true;
                signalCount = barWidth.length; // Сбросить счетчик
            }
        }
        setTimeout(animateBars, 100);
    }

    animateBars();
}

// Инициализация страницы при загрузке
document.addEventListener('DOMContentLoaded', initializePage);

// Добавляем обработчики событий для стрелок
$('.arrow').off('click').on('click', changeFreq);

// Обработчик для кнопки "Прослушать передачу"
$('#start-transmission').on('click', async function(event) {
    event.stopPropagation();
    
    var currentFrequency = getCurrentFrequency();
    console.log(`Loading dialogue for frequency: ${currentFrequency}`);
    
    if (!state.currentDialogue) {
        state.currentDialogue = games[state.currentGame]['dialogues'][currentFrequency];
        console.log(`From local games: ${state.currentDialogue ? 'found' : 'not found'}`);
    }
    
    if (!state.currentDialogue) {
        state.currentDialogue = await loadDialogueFromDB(currentFrequency);
        console.log(`From DB: ${state.currentDialogue ? 'found' : 'not found'}`);
        if (state.currentDialogue && !games[state.currentGame]['dialogues'][currentFrequency]) {
            games[state.currentGame]['dialogues'][currentFrequency] = state.currentDialogue;
        }
    }
    
    if (state.currentDialogue) {
        // Получаем текст кнопки, чтобы определить, продолжаем мы диалог или начинаем заново
        const buttonText = $(this).find('.start-link').text();
        
        console.log(`Нажата кнопка "${buttonText}", текущая позиция: ${state.count}`);
        
        // Проверяем, не является ли текущая позиция последней строкой диалога
        const isLastLine = state.count >= state.currentDialogue.conversations.length - 1;
        
        if (isLastLine && (buttonText === 'Продолжить передачу' || buttonText === 'Показать последнюю строку')) {
            console.log(`Текущая позиция (${state.count}) - последняя строка диалога. Завершаем диалог.`);
            
            // Если это последняя строка, восстанавливаем диалог и показываем последнюю строку
            restoreDialoguePosition();
            
            // После показа последней строки, отметим диалог как завершенный в следующем клике
        } else if (buttonText === 'Продолжить передачу' || buttonText === 'Показать последнюю строку') {
            // Восстанавливаем диалог с сохраненной позиции
            console.log(`Восстанавливаем диалог с текущей позиции (${state.count})`);
            
            // ВАЖНОЕ ИЗМЕНЕНИЕ: Убедимся, что при восстановлении будет показана текущая строка
            // а не следующая. Это особенно важно если count === 0.
            restoreDialoguePosition();
} else {
            console.log('Начинаем диалог заново');
            currentConversation(true);
        }
    } else {
        console.error(`Диалог для частоты ${currentFrequency} не найден`);
        $('#text').text('*НЕТ СВЯЗИ*');
        $('#c-char').text('');
        $('#start-transmission').addClass('hidden');
    }
    
    logDialogueState();
});

// Обработчик для кнопки повтора
$('#repeat-transmission').on('click', function() {
    // Проверяем, завершен ли диалог
    if (state.isTransmissionEnded) {
        // Получаем текущую частоту
        const currentFrequency = getCurrentFrequency();
        
        // Увеличиваем счетчик прослушиваний
        if (!state.repeatCount[currentFrequency]) {
            state.repeatCount[currentFrequency] = 1;
        } else {
            state.repeatCount[currentFrequency]++;
        }
        
        // Сохраняем обновленные счетчики
        saveRepeatCounts();
        
        console.log(`Повторное прослушивание диалога на частоте ${currentFrequency}, счетчик: ${state.repeatCount[currentFrequency]}`);
        
        // Перезагружаем диалог для просмотра
        state.currentDialogue = games[state.currentGame]['dialogues'][currentFrequency];
        
        if (state.currentDialogue) {
            // Сбрасываем счетчик
            state.count = 0;
            
            // Устанавливаем изображения персонажей
            initializeCharacterPortraits();
            
            // Очищаем текст и имя персонажа
            $('#text').text('');
            $('#c-char').text('');
            
            // Скрываем кнопку повтора
            $(this).addClass('hidden');
            
            // Сбрасываем флаг
            state.isTransmissionEnded = false;
            
            // Показываем первую строку диалога
            showNextLine();
        }
    }
});

// Обработчик клика на текстовом контейнере
$('#text-con').on('click', function(event) {
    // Проверяем, что клик не был по кнопке "Прослушать передачу" или по элементам выбора
    if (!$(event.target).is('#start-transmission') && 
        !$(event.target).is('#repeat-transmission') &&
        !$(event.target).closest('.choice-container').length &&
        !$(event.target).closest('.start-link').length) {
        
        // Проверяем, что нет контейнера выбора на странице
        const hasChoiceContainer = $('.choice-container').length > 0;
        
        // Если есть контейнер выбора, не обрабатываем клик на текст
        if (hasChoiceContainer) {
            console.log('Варианты ответа уже отображены, игнорируем клик на текст');
            return;
        }
        
        // Если диалог существует, не завершен и не идет печать
        if (state.currentDialogue && !state.isTransmissionEnded && !$(this).hasClass('typing-in-progress')) {
            console.log('Клик для продолжения диалога, текущая позиция:', state.count);
            
            // ВАЖНОЕ ИЗМЕНЕНИЕ: Проверяем, не находимся ли мы после последней строки диалога
            // Если да, то это значит, что пользователь кликнул после отображения последней строки
            // и хочет закончить диалог
            if (state.count >= state.currentDialogue.conversations.length) {
                console.log('Пользователь кликнул после последней строки, завершаем диалог');
                endTransmission();
                return;
            }
            
            // Переходим к следующей строке диалога
            showNextLine();
        }
    }
});

// Добавим функцию для загрузки счетчика повторных прослушиваний при инициализации страницы
async function loadRepeatCounts() {
    try {
        // Проверяем доступность API
        const isApiAvailable = await checkRepeatCountsApiAvailability();
        
        // Загружаем счетчики из localStorage
        const savedRepeatCounts = localStorage.getItem(`dialogueRepeatCounts_${state.userName}`);
        
        if (savedRepeatCounts) {
            try {
                const parsedCounts = JSON.parse(savedRepeatCounts);
                
                // Проверяем, что загруженные данные являются объектом
                if (parsedCounts && typeof parsedCounts === 'object') {
                    // Обновляем счетчики в состоянии приложения
                    state.repeatCount = parsedCounts;
                    console.log('Загружены счетчики повторных прослушиваний из localStorage:', state.repeatCount);
                }
            } catch (parseError) {
                console.error('Ошибка при разборе сохраненных счетчиков:', parseError);
                // Если произошла ошибка при разборе JSON, инициализируем пустой объект
                state.repeatCount = {};
            }
        } else {
            console.log('Счетчики повторных прослушиваний не найдены в localStorage, инициализируем пустой объект');
            state.repeatCount = {};
        }
        
        // Если API доступно, синхронизируем с сервером
        if (isApiAvailable) {
            try {
                const response = await fetch(`${API_URL}/repeat-counts`, {
                    credentials: 'include',
                    headers: {
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    
                    if (data.repeatCounts && typeof data.repeatCounts === 'object') {
                                        // Объединяем данные с сервера и локальные данные (приоритет у более высоких значений)
                        for (const freq in data.repeatCounts) {
                            if (!state.repeatCount[freq] || state.repeatCount[freq] < data.repeatCounts[freq]) {
                                state.repeatCount[freq] = data.repeatCounts[freq];
                            }
                        }
                        
                        console.log('Счетчики синхронизированы с сервером:', state.repeatCount);
                        
                        // Сохраняем объединенные данные локально
                        localStorage.setItem(`dialogueRepeatCounts_${state.userName}`, JSON.stringify(state.repeatCount));
                    }
                }
            } catch (serverError) {
                console.warn('Не удалось синхронизировать счетчики с сервером:', serverError);
                // Продолжаем работу с локальными данными
            }
        } else {
            console.log('API для счетчиков повторений недоступно, используем только локальное хранилище');
        }
    } catch (error) {
        console.error('Ошибка при загрузке счетчиков повторных прослушиваний:', error);
        state.repeatCount = {};
    }
}

function saveRepeatCounts() {
    try {
        // Сохраняем счетчики в localStorage с учетом имени пользователя
        localStorage.setItem(`dialogueRepeatCounts_${state.userName}`, JSON.stringify(state.repeatCount));
        console.log('Счетчики повторных прослушиваний сохранены в localStorage:', state.repeatCount);
        
        // Проверяем доступность API перед отправкой
        checkRepeatCountsApiAvailability().then(isAvailable => {
            if (isAvailable) {
                // Если API доступно, выполняем синхронизацию с сервером
                fetch(`${API_URL}/repeat-counts`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ repeatCounts: state.repeatCount }),
                    credentials: 'include'
                }).then(response => {
                    if (response.ok) {
                        console.log('Счетчики успешно сохранены на сервере');
                    } else {
                        console.warn('Не удалось сохранить счетчики на сервере, код ответа:', response.status);
                    }
                }).catch(error => {
                    console.warn('Не удалось сохранить счетчики на сервере:', error);
                });
            } else {
                console.log('API для счетчиков недоступно, данные сохранены только локально');
            }
        }).catch(() => {
            console.warn('Не удалось проверить доступность API, данные сохранены только локально');
        });
    } catch (error) {
        console.error('Ошибка при сохранении счетчиков повторных прослушиваний:', error);
    }
}

// Глобальные переменные для управления эффектами
const glitchEffects = {
    isActive: false,
    intensity: 0,
    timer: null,
    activeEffects: []
};

/**
 * Активация эффекта глюка интерфейса
 * @param {number} intensity - Интенсивность глюка (0-10)
 * @param {boolean} redTheme - Включить красную тему
 * @param {Array} effects - Список эффектов для применения
 * @param {number} duration - Продолжительность эффекта в мс (0 для бесконечного)
 */
function activateGlitchEffect(intensity = 5, redTheme = true, effects = [], duration = 0) {
    // Сбрасываем предыдущие эффекты
    clearGlitchEffects();
    
    // Устанавливаем интенсивность
    glitchEffects.intensity = Math.min(10, Math.max(0, intensity));
    glitchEffects.isActive = true;
    
    console.log(`Активация глюк-эффекта с интенсивностью ${glitchEffects.intensity}`);
    
    // Если нужна красная тема, применяем ее
    if (redTheme) {
        $('body').addClass('red-theme');
    }
    
    // Если не указаны конкретные эффекты, выбираем их на основе интенсивности
    if (effects.length === 0) {
        if (intensity <= 3) {
            effects = ['text-flicker', 'jitter', 'glitch-lines'];
        } else if (intensity <= 6) {
            effects = ['text-flicker', 'glitch-lines', 'screen-shift', 'broken-pixels', 'signal-interference'];
        } else {
            effects = ['text-flicker', 'glitch-lines', 'broken-pixels', 'screen-shift', 'terminal-glitch', 'critical-state', 'signal-interference'];
            // Добавляем фоновый шум на высокой интенсивности
            addScreenNoise();
        }
    }
    
    // Применяем выбранные эффекты
    glitchEffects.activeEffects = effects;
    applyGlitchEffects(effects);
    
    // Начинаем случайные глюки с периодичностью
    startRandomGlitches();
    
    // Если указана продолжительность, устанавливаем таймер для сброса
    if (duration > 0) {
        glitchEffects.timer = setTimeout(() => {
            clearGlitchEffects();
        }, duration);
    }
}

/**
 * Очистка всех эффектов глюка
 */
function clearGlitchEffects() {
    console.log('Очистка эффектов глюка');
    
    // Останавливаем таймер, если он активен
    if (glitchEffects.timer) {
        clearTimeout(glitchEffects.timer);
        glitchEffects.timer = null;
    }
    
    // Останавливаем случайные глюки
    stopRandomGlitches();
    
    // Удаляем красную тему
    $('body').removeClass('red-theme');
	
	// Удаляем все активные классы эффектов
    $('#mCodec, .char-box, #text-con, #c-char, #text').removeClass(
        'glitch-effect text-flicker glitch-lines jitter broken-pixels ' +
        'terminal-glitch critical-state signal-interference screen-shift ' +
        'image-distortion rgb-split per-glitch-effect'
    );
    
    // Удаляем фоновый шум, если он был добавлен
    removeScreenNoise();
    
    // Сбрасываем настройки
    glitchEffects.isActive = false;
    glitchEffects.intensity = 0;
    glitchEffects.activeEffects = [];
}

/**
 * Добавление эффекта фонового шума
 */
function addScreenNoise() {
    // Удаляем существующий шум, если он есть
    removeScreenNoise();
    
    // Создаем элемент шума
    const noiseElement = document.createElement('div');
    noiseElement.id = 'screen-noise-overlay';
    noiseElement.className = 'screen-noise';
    document.body.appendChild(noiseElement);
}

/**
 * Удаление эффекта фонового шума
 */
function removeScreenNoise() {
    const noiseElement = document.getElementById('screen-noise-overlay');
    if (noiseElement) {
        noiseElement.remove();
    }
}

/**
 * Применение указанных эффектов глюка
 * @param {Array} effects - Список эффектов для применения
 */
function applyGlitchEffects(effects) {
    // Применяем эффекты к различным элементам интерфейса
    if (effects.includes('text-flicker')) {
        $('#text, #c-char').addClass('text-flicker');
    }
    
    if (effects.includes('glitch-lines')) {
        $('#text-con, #mCodec').addClass('glitch-lines');
    }
    
    if (effects.includes('jitter')) {
        $('.char-box').addClass('jitter');
    }
    
    if (effects.includes('broken-pixels')) {
        $('#mCodec').addClass('broken-pixels');
    }
    
    if (effects.includes('terminal-glitch')) {
        $('#text').addClass('terminal-glitch');
    }
    
    if (effects.includes('critical-state')) {
        $('#text-con, .char-box').addClass('critical-state');
    }
    
    if (effects.includes('signal-interference')) {
        $('#text, #c-char, .freq').each(function() {
            const $this = $(this);
            $this.attr('data-text', $this.text());
            $this.addClass('signal-interference');
        });
    }
    
    if (effects.includes('screen-shift')) {
        $('#mCodec').addClass('screen-shift');
    }
    
    if (effects.includes('image-distortion')) {
        $('.char-box').addClass('image-distortion');
    }
    
    if (effects.includes('per-glitch-effect')) {
        $('#text-con, .char-box, #mCodec').addClass('per-glitch-effect');
    }
}

// Переменные для управления случайными глюками
let randomGlitchesInterval = null;

/**
 * Запуск периодических случайных глюков
 */
function startRandomGlitches() {
    if (randomGlitchesInterval) {
        clearInterval(randomGlitchesInterval);
    }
	
	// Определяем интервал на основе интенсивности (чем выше интенсивность, тем чаще глюки)
    const interval = Math.max(100, 1000 - glitchEffects.intensity * 90);
    
    randomGlitchesInterval = setInterval(() => {
        if (!glitchEffects.isActive) return;
        
        // С вероятностью, зависящей от интенсивности, запускаем случайный глюк
        if (Math.random() < (glitchEffects.intensity / 20)) {
            triggerRandomGlitch();
        }
    }, interval);
}

/**
 * Остановка периодических случайных глюков
 */
function stopRandomGlitches() {
    if (randomGlitchesInterval) {
        clearInterval(randomGlitchesInterval);
        randomGlitchesInterval = null;
    }
}

/**
 * Запуск случайного глюка
 */
function triggerRandomGlitch() {
    // Выбираем случайный тип глюка
    const glitchTypes = [
        'quick-flicker',    // Быстрое мигание
        'text-scramble',    // Кратковременное искажение текста
        'screen-jitter',    // Тряска экрана
        'color-shift',      // Смещение цвета
        'audio-glitch'      // Звуковой глюк
    ];
    
    const glitchType = glitchTypes[Math.floor(Math.random() * glitchTypes.length)];
    
    switch (glitchType) {
        case 'quick-flicker':
            // Быстрое мигание всего экрана
            const flickerElement = $('<div>').css({
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(255, 0, 0, 0.2)',
                zIndex: 9999,
                pointerEvents: 'none'
            }).appendTo('body');
            
            setTimeout(() => {
                flickerElement.remove();
            }, 50 + Math.random() * 100);
            break;
            
        case 'text-scramble':
            // Сохраняем оригинальный текст
            const originalText = $('#text').text();
            const scrambledText = scrambleText(originalText);
            
            $('#text').text(scrambledText);
            
            setTimeout(() => {
                $('#text').text(originalText);
            }, 100 + Math.random() * 200);
            break;
            
        case 'screen-jitter':
            // Добавляем класс тряски ко всему контейнеру
            $('#mCodec').addClass('screen-shift');
            
            setTimeout(() => {
                $('#mCodec').removeClass('screen-shift');
            }, 300 + Math.random() * 200);
            break;
            
        case 'color-shift':
            // Временно меняем цвет интерфейса
            $('body').addClass('red-theme');
            
            // После короткой задержки возвращаем обычный цвет, если только не активна красная тема
            setTimeout(() => {
                if (!glitchEffects.isActive || !glitchEffects.activeEffects.includes('red-theme')) {
                    $('body').removeClass('red-theme');
                }
            }, 200 + Math.random() * 300);
            break;
            
        case 'audio-glitch':
            // Воспроизводим короткий звук помех
            playGlitchSound();
            break;
    }
}

/**
 * Воспроизведение звука помех
 */
function playGlitchSound() {
    // Создаем осциллятор для генерации звука
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        // Настраиваем осциллятор на белый шум
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(Math.random() * 300 + 100, audioContext.currentTime);
        
        // Настраиваем громкость и подключаем узлы
        gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Запускаем осциллятор и останавливаем через короткое время
        oscillator.start();
        oscillator.stop(audioContext.currentTime + 0.1);
    } catch (e) {
        console.warn('Не удалось воспроизвести звук глюка:', e);
    }
}

/**
 * Создание искаженного текста
 * @param {string} text - Исходный текст
 * @returns {string} - Искаженный текст
 */
function scrambleText(text) {
    if (!text) return '';
    
    // Символы для замены
    const glitchChars = '!@#$%^&*()_+-=[]{}|;:,.<>?/\\~`1234567890абвгдеёжзийклмнопрстуфхцчшщъыьэюя';
    
    // Заменяем случайные символы в тексте
    let result = '';
    for (let i = 0; i < text.length; i++) {
        // Заменяем символ с вероятностью 30%
        if (Math.random() < 0.3) {
            result += glitchChars.charAt(Math.floor(Math.random() * glitchChars.length));
        } else {
            result += text.charAt(i);
        }
    }
    
    return result;
}

/**
 * Активация заранее определенных последовательностей глюков для диалога PER
 * @param {string} triggerId - Идентификатор триггера глюка в диалоге
 */
function activateDialogueGlitch(triggerId) {
    if (triggerId === 'per-initial') {
        // Первое появление глюка в начале диалога PER
        activateGlitchEffect(3, true, ['text-flicker', 'jitter', 'glitch-lines'], 5000);
        
        // Через несколько секунд добавим аудио-глюк
        setTimeout(() => {
            playGlitchSound();
        }, 2000);
    }
    else if (triggerId === 'per-strong') {
        // Сильный глюк во время диалога PER
        activateGlitchEffect(8, true, 
            ['text-flicker', 'glitch-lines', 'broken-pixels', 'screen-shift', 
             'terminal-glitch', 'critical-state', 'signal-interference', 'per-glitch-effect'], 
            8000);
        
        // Добавляем звуковой эффект
        playGlitchSound();
		
		// Еще несколько звуковых эффектов с задержкой
        setTimeout(() => playGlitchSound(), 1000);
        setTimeout(() => playGlitchSound(), 3000);
        setTimeout(() => playGlitchSound(), 5000);
    }
    else if (triggerId === 'per-critical') {
        // Критический глюк в конце диалога PER
        activateGlitchEffect(10, true, 
            ['text-flicker', 'glitch-lines', 'broken-pixels', 'screen-shift', 
             'terminal-glitch', 'critical-state', 'signal-interference', 'per-glitch-effect'], 
            12000);
        
        // Добавляем звуковой эффект
        playGlitchSound();
        
        // Серия звуковых эффектов
        for (let i = 1; i <= 10; i++) {
            setTimeout(() => playGlitchSound(), i * 800);
        }
        
        // Создаем очень сильные визуальные помехи
        addScreenNoise();
        
        // Добавляем мигающий красный экран
        const redFlash = $('<div>').css({
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(255, 0, 0, 0.3)',
            zIndex: 9998,
            pointerEvents: 'none',
            animation: 'critical-flicker 0.1s infinite alternate'
        }).appendTo('body');
        
        // Удаляем мигающий красный экран после завершения эффекта
        setTimeout(() => {
            redFlash.remove();
        }, 12000);
    }
}

// Добавляем стили для элементов выбора
$('<style>')
    .text(`
        .choice-container {
            display: flex;
            flex-direction: column;
            gap: 10px;
            margin-top: 15px;
        }
        
        .choice-button {
            background-color: rgba(0, 0, 0, 0.7);
            border: 1px solid #03FB8D;
            color: #03FB8D;
            padding: 8px 15px;
            font-family: 'TeletactileRus', monospace;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.3s;
            text-align: left;
        }
        
        .choice-button:hover {
            background-color: #03FB8D;
            color: black;
        }
        
        /* Стили для отключенной кнопки повтора */
        #repeat-transmission.disabled {
            opacity: 0.3;
            cursor: not-allowed;
            pointer-events: none;
        }
        
        /* Индикатор прогресса диалога */
        .dialogue-progress {
            position: absolute;
            bottom: 5px;
            right: 10px;
            font-size: 10px;
            color: rgba(3, 251, 141, 0.7);
            font-family: 'TeletactileRus', monospace;
        }
		
		/* Стиль для блокировки интерфейса во время обработки выбора */
        #text-con.processing-choice {
            pointer-events: none;
            opacity: 0.9;
        }
		
		/* Стиль для текстового контейнера с активными выборами */
		#text-con.choices-active {
			cursor: default; /* Меняем курсор для визуальной индикации */
		}
    `)
    .appendTo('head');

// Добавляем кнопку выхода из системы
$(document).ready(function() {
    // Создаем кнопку выхода и добавляем ее на страницу
    const logoutButton = $('<div id="logout-btn">ВЫХОД</div>');
    $('body').append(logoutButton);
    
	// Инициализация эффектов глюков
    initGlitchEffects();
	
    // Стилизуем кнопку выхода
    $('#logout-btn').css({
        'position': 'fixed',
        'top': '20px',
        'right': '20px',
        'background-color': 'black',
        'color': '#03FB8D',
        'border': '1px solid #03FB8D',
        'padding': '8px 15px',
        'font-family': 'Orbitron, sans-serif',
        'font-size': '12px',
        'cursor': 'pointer',
        'z-index': '9999',
        'box-shadow': '0 0 10px rgba(3, 251, 141, 0.5)'
    });
    
    // Добавляем эффект наведения
    $('#logout-btn').hover(
        function() {
            $(this).css({
                'background-color': '#03FB8D',
                'color': 'black'
            });
        },
        function() {
            $(this).css({
                'background-color': 'black',
                'color': '#03FB8D'
            });
        }
    );
    
    // Добавляем обработчик события для выхода
    $('#logout-btn').on('click', async function() {
        try {
            await fetch(`${API_URL}/logout`, {
                method: 'POST',
                credentials: 'include'
            });
            
            // Перенаправляем на страницу входа
            window.location.href = 'login.html';
        } catch (error) {
            console.
            console.error('Ошибка при выходе:', error);
        }
    });
    
    // Добавляем индикатор прогресса диалога, если его еще нет
    if ($('.dialogue-progress').length === 0) {
        const progressIndicator = $('<div class="dialogue-progress"></div>');
        $('#text-con').append(progressIndicator);
    }
    
    // Функция для обновления индикатора прогресса
    function updateProgressIndicator() {
        if (state.currentDialogue && state.currentDialogue.conversations) {
            const total = state.currentDialogue.conversations.length;
            const current = Math.min(state.count + 1, total);
            $('.dialogue-progress').text(`${current}/${total}`);
        } else {
            $('.dialogue-progress').text('');
        }
    }
    
    // Переопределяем функцию showNextLine для обновления индикатора
    const originalShowNextLine = showNextLine;
    window.showNextLine = function() {
        // Вызываем оригинальную функцию
        originalShowNextLine();
        // Обновляем индикатор прогресса
        updateProgressIndicator();
    };
    
    // Запускаем создание эффекта полосок и анимацию
    createBarEffect();
    barSignal();
    $('#bars-con').children().eq(0).css('display', 'none');
    
    // Также обновляем индикатор после инициализации
    const originalInitializeTransmission = initializeTransmission;
    window.initializeTransmission = async function() {
        await originalInitializeTransmission();
        updateProgressIndicator();
    };
});

/**
 * Инициализация эффектов глюков
 */
function initGlitchEffects() {
    // Предварительная загрузка звуков для глюков
    preloadGlitchSounds();
    
    // Очистка всех эффектов глюков при начальной загрузке
    clearGlitchEffects();
    
    console.log('Эффекты глюков инициализированы');
}

/**
 * Предварительная загрузка звуков для глюков
 */
function preloadGlitchSounds() {
    try {
        const glitchSounds = [
            'assets/sounds/voices/glitch/1.mp3',
            'assets/sounds/voices/glitch/2.mp3',
            'assets/sounds/voices/glitch/static.mp3'
        ];
        
        glitchSounds.forEach(sound => {
            const audio = new Audio();
            audio.src = getAssetUrl(sound);
            audio.preload = 'auto';
            audio.volume = 0.01;
            audio.muted = true;
            
            // Воспроизведем и сразу остановим для предзагрузки в некоторых браузерах
            audio.play().catch(() => {}).then(() => {
                audio.pause();
                audio.currentTime = 0;
            });
        });
    } catch (e) {
        console.warn('Не удалось предзагрузить звуки глюков:', e);
    }
}