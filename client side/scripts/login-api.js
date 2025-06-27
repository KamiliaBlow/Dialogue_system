// API URL
const API_URL = 'https://yousite:3000/api';

// Переключение между формами
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

// Очистка ошибок
function clearErrors() {
  const errorElements = document.querySelectorAll('.form-error');
  errorElements.forEach(element => {
    element.style.display = 'none';
  });

  // Сбросить поля ввода
  document.getElementById('loginUsername').value = '';
  document.getElementById('loginPassword').value = '';
  document.getElementById('registerUsername').value = '';
  document.getElementById('registerPassword').value = '';
}

// Авторизация
document.getElementById('loginButton').addEventListener('click', async () => {
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  let hasErrors = false;

  // Проверка полей
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
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password }),
      credentials: 'include'
    });

    const data = await response.json();

    if (!response.ok) {
      document.getElementById('loginError').textContent = data.message || 'Ошибка входа в систему';
      document.getElementById('loginError').style.display = 'block';
      return;
    }

    // Успешная авторизация
    localStorage.setItem('username', data.username);
    window.location.href = 'splash.html'; // Перенаправление на основную страницу

  } catch (error) {
    console.error('Ошибка:', error);
    document.getElementById('loginError').textContent = 'Проблемы с соединением';
    document.getElementById('loginError').style.display = 'block';
  }
});

// Регистрация
document.getElementById('registerButton').addEventListener('click', async () => {
  const username = document.getElementById('registerUsername').value.trim();
  const password = document.getElementById('registerPassword').value;
  let hasErrors = false;

  // Проверка полей
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
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password }),
      credentials: 'include'
    });

    const data = await response.json();

    if (!response.ok) {
      document.getElementById('registerError').textContent = data.message || 'Ошибка при регистрации';
      document.getElementById('registerError').style.display = 'block';
      return;
    }

    // Успешная регистрация
    localStorage.setItem('username', data.username);
    window.location.href = 'splash.html'; // Перенаправление на основную страницу

  } catch (error) {
    console.error('Ошибка:', error);
    document.getElementById('registerError').textContent = 'Проблемы с соединением';
    document.getElementById('registerError').style.display = 'block';
  }
});

// Проверка авторизации при загрузке страницы
window.addEventListener('DOMContentLoaded', async () => {
  try {
    const response = await fetch(`${API_URL}/check-auth`, {
      credentials: 'include'
    });

    const data = await response.json();

    if (data.isAuthenticated) {
      window.location.href = 'splash.html'; // Перенаправление на основную страницу, если пользователь уже авторизован
    }
  } catch (error) {
    console.error('Ошибка при проверке авторизации:', error);
  }

  // Генерация фонового кода
  generateBackgroundCode();
});

// Генерация случайного "кода" для фона
function generateBackgroundCode() {
  const bgCode = document.getElementById('bgCode');
  const codeCharacters = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!@#$%^&*()_+{}[]|:;<>,.?/~`";
  const numLines = 20;

  for (let i = 0; i < numLines; i++) {
    const line = document.createElement('div');
    line.className = 'code-line';

    // Случайное содержимое
    let lineContent = '';
    const lineLength = Math.floor(Math.random() * 30) + 10;

    for (let j = 0; j < lineLength; j++) {
      lineContent += codeCharacters.charAt(Math.floor(Math.random() * codeCharacters.length));
    }

    line.textContent = lineContent;

    // Случайное положение и задержка
    line.style.left = `${Math.random() * 100}%`;
    line.style.animationDuration = `${Math.random() * 15 + 5}s`;
    line.style.animationDelay = `${Math.random() * 5}s`;

    bgCode.appendChild(line);
  }
}
