require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3000,
    SESSION_SECRET: process.env.SESSION_SECRET || 'REPLACEMESECRETKEY',
    CORS_ORIGINS: (process.env.CORS_ORIGINS || 'https://REPLACEME,https://REPLACEME').split(',').map(s => s.trim()),
    SESSION_MAX_AGE: 24 * 60 * 60 * 1000,
    SSL_KEY_PATH: process.env.SSL_KEY_PATH || 'ssl/privkey.pem',
    SSL_CERT_PATH: process.env.SSL_CERT_PATH || 'ssl/cert.pem',
    SETUP_KEY: process.env.SETUP_KEY || 'REPLACEMESETUPKEY',
    DB_PATH: process.env.DB_PATH || './database.db',
    DEBUG: process.env.DEBUG === 'false',
    
    validate() {
        if (this.SESSION_SECRET === 'REPLACEMESECRETKEY') {
            console.warn('WARNING: Using default SESSION_SECRET. Set SESSION_SECRET in .env');
        }
        if (this.SETUP_KEY === 'REPLACEMESETUPKEY') {
            console.warn('WARNING: Using default SETUP_KEY. Set SETUP_KEY in .env');
        }
    }
};
