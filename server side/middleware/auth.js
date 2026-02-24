function requireAuth(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({ message: 'Требуется авторизация' });
    }
    next();
}

function requireAdmin(db) {
    return (req, res, next) => {
        if (!req.session.userId) {
            return res.status(401).json({ message: 'Требуется авторизация' });
        }
        
        db.get('SELECT is_admin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
            if (err) {
                return res.status(500).json({ message: 'Ошибка сервера', error: err.message });
            }
            
            if (!user || user.is_admin !== 1) {
                return res.status(403).json({ message: 'Недостаточно прав' });
            }
            
            next();
        });
    };
}

module.exports = { requireAuth, requireAdmin };
