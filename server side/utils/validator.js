const Validator = {
    username(value) {
        if (!value || typeof value !== 'string') {
            return { valid: false, error: 'Имя пользователя обязательно' };
        }
        const trimmed = value.trim();
        if (trimmed.length < 3) {
            return { valid: false, error: 'Имя пользователя минимум 3 символа' };
        }
        if (trimmed.length > 50) {
            return { valid: false, error: 'Имя пользователя максимум 50 символов' };
        }
        if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
            return { valid: false, error: 'Только латинские буквы, цифры и _' };
        }
        return { valid: true, value: trimmed };
    },
    
    password(value) {
        if (!value || typeof value !== 'string') {
            return { valid: false, error: 'Пароль обязателен' };
        }
        if (value.length < 6) {
            return { valid: false, error: 'Пароль минимум 6 символов' };
        }
        return { valid: true, value };
    },
    
    frequency(value) {
        if (!value || typeof value !== 'string') {
            return { valid: false, error: 'Частота обязательна' };
        }
        if (value.length > 20) {
            return { valid: false, error: 'Частота максимум 20 символов' };
        }
        return { valid: true, value: value.trim() };
    },
    
    choiceId(value) {
        if (!value || typeof value !== 'string') {
            return { valid: false, error: 'ID выбора обязателен' };
        }
        if (value.length > 100) {
            return { valid: false, error: 'ID выбора максимум 100 символов' };
        }
        return { valid: true, value: value.trim() };
    },
    
    userId(value) {
        const id = parseInt(value);
        if (isNaN(id) || id < 1) {
            return { valid: false, error: 'Некорректный ID пользователя' };
        }
        return { valid: true, value: id };
    },
    
    progress(value) {
        const progress = parseInt(value);
        if (isNaN(progress) || progress < 0) {
            return { valid: false, error: 'Некорректное значение прогресса' };
        }
        return { valid: true, value: progress };
    }
};

function validateBody(schema) {
    return (req, res, next) => {
        const errors = [];
        const sanitized = {};
        
        for (const [field, validator] of Object.entries(schema)) {
            const result = validator(req.body[field]);
            if (!result.valid) {
                errors.push({ field, error: result.error });
            } else {
                sanitized[field] = result.value;
            }
        }
        
        if (errors.length > 0) {
            return res.status(400).json({
                message: 'Ошибка валидации',
                errors
            });
        }
        
        req.sanitizedBody = sanitized;
        next();
    };
}

module.exports = { Validator, validateBody };
