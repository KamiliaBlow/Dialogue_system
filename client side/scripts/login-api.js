let API_URL = null;

function capitalizeName(name) {
    if (!name) return '';
    return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

async function initLogin() {
    try {
        const timestamp = Date.now();
        const module = await import(`./config.js?t=${timestamp}`);
        API_URL = module.default.API_URL;
    } catch (error) {
        console.error('Failed to load config with cache busting:', error);
        // Fallback
        const module = await import('./config.js');
        API_URL = module.default.API_URL;
    }
    
    initEventListeners();
    checkExistingAuth();
}

function initEventListeners() {
    document.getElementById('showRegister').addEventListener('click', () => {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'block';
        clearErrors();
    });

    document.getElementById('showLogin').addEventListener('click', () => {
        document.getElementById('registerForm').style.display = 'none';
        document.getElementById('loginForm').style.display = 'block';
        clearErrors();
    });

    document.getElementById('loginButton').addEventListener('click', handleLogin);
    document.getElementById('registerButton').addEventListener('click', handleRegister);
}

function clearErrors() {
    document.querySelectorAll('.form-error').forEach(el => el.style.display = 'none');
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('registerUsername').value = '';
    document.getElementById('registerPassword').value = '';
}

async function handleLogin() {
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value;
    let hasErrors = false;

    if (!username) {
        document.getElementById('loginUsernameError').style.display = 'block';
        hasErrors = true;
    } else {
        document.getElementById('loginUsernameError').style.display = 'none';
    }

    if (!password) {
        document.getElementById('loginPasswordError').style.display = 'block';
        hasErrors = true;
    } else {
        document.getElementById('loginPasswordError').style.display = 'none';
    }

    if (hasErrors) return;

    try {
        const response = await fetch(`${API_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include'
        });

        const data = await response.json();

        if (!response.ok) {
            document.getElementById('loginError').textContent = data.message || 'Ошибка входа';
            document.getElementById('loginError').style.display = 'block';
            return;
        }

        localStorage.setItem('username', data.username);
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Ошибка:', error);
        document.getElementById('loginError').textContent = 'Проблемы с соединением';
        document.getElementById('loginError').style.display = 'block';
    }
}

// Те же правила, что у сервера (server side/utils/validator.js): иначе форма пропускает
// позывной или код доступа, а сервер потом отказывает.
function usernameProblem(username) {
    if (username.length < 3) return 'Позывной — минимум 3 символа.';
    if (username.length > 50) return 'Позывной — максимум 50 символов.';
    if (!/^[a-zA-Z0-9_]+$/.test(username)) return 'Позывной: только латинские буквы, цифры и _.';
    return '';
}

function passwordProblem(password) {
    if (password.length < 8) return 'Код доступа — минимум 8 символов.';
    if (password.length > 100) return 'Код доступа — максимум 100 символов.';
    if (!/[a-zA-Zа-яА-ЯёЁ]/.test(password) || !/[0-9]/.test(password)) return 'Код доступа должен содержать и буквы, и цифры.';
    return '';
}

function showFieldError(id, message) {
    const el = document.getElementById(id);
    el.textContent = message;
    el.style.display = message ? 'block' : 'none';
}

async function handleRegister() {
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    const usernameError = usernameProblem(username);
    const passwordError = passwordProblem(password);
    showFieldError('registerUsernameError', usernameError);
    showFieldError('registerPasswordError', passwordError);
    if (usernameError || passwordError) return;

    try {
        const response = await fetch(`${API_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
            credentials: 'include'
        });

        const data = await response.json();

        if (!response.ok) {
            document.getElementById('registerError').textContent = data.message || 'Ошибка регистрации';
            document.getElementById('registerError').style.display = 'block';
            return;
        }

        localStorage.setItem('username', data.username);

        // После регистрации — обязательная первичная настройка пилота.
        window.location.href = 'pilot_profile.html?first=1';
    } catch (error) {
        console.error('Ошибка:', error);
        document.getElementById('registerError').textContent = 'Проблемы с соединением';
        document.getElementById('registerError').style.display = 'block';
    }
}

async function checkExistingAuth() {
    try {
        const response = await fetch(`${API_URL}/check-auth`, {
            credentials: 'include'
        });

        const data = await response.json();

        if (data.isAuthenticated) {
            window.location.href = 'index.html';
        }
    } catch (error) {
        console.error('Ошибка при проверке авторизации:', error);
    }

}


document.addEventListener('DOMContentLoaded', initLogin);
