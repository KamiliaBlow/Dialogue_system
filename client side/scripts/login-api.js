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
        window.location.href = 'splash.html';
    } catch (error) {
        console.error('Ошибка:', error);
        document.getElementById('loginError').textContent = 'Проблемы с соединением';
        document.getElementById('loginError').style.display = 'block';
    }
}

async function handleRegister() {
    const username = document.getElementById('registerUsername').value.trim();
    const password = document.getElementById('registerPassword').value;
    let hasErrors = false;

    if (!username || username.length < 3) {
        document.getElementById('registerUsernameError').style.display = 'block';
        hasErrors = true;
    } else {
        document.getElementById('registerUsernameError').style.display = 'none';
    }

    if (!password || password.length < 6) {
        document.getElementById('registerPasswordError').style.display = 'block';
        hasErrors = true;
    } else {
        document.getElementById('registerPasswordError').style.display = 'none';
    }

    if (hasErrors) return;

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

        window.location.href = 'splash.html';
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
            window.location.href = 'splash.html';
        }
    } catch (error) {
        console.error('Ошибка при проверке авторизации:', error);
    }

    generateBackgroundCode();
}

function generateBackgroundCode() {
    const bgCode = document.getElementById('bgCode');
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+{}[]|:;<>,.?/~`";

    for (let i = 0; i < 20; i++) {
        const line = document.createElement('div');
        line.className = 'code-line';
        
        let content = '';
        const len = Math.floor(Math.random() * 30) + 10;
        for (let j = 0; j < len; j++) {
            content += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        
        line.textContent = content;
        line.style.left = `${Math.random() * 100}%`;
        line.style.animationDuration = `${Math.random() * 15 + 5}s`;
        line.style.animationDelay = `${Math.random() * 5}s`;
        
        bgCode.appendChild(line);
    }
}

document.addEventListener('DOMContentLoaded', initLogin);
