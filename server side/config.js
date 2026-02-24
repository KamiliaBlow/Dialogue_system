require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3000,
    SESSION_SECRET: process.env.SESSION_SECRET || 'secret-key-change-in-production,
    CORS_ORIGINS: (process.env.CORS_ORIGINS || 'https://DOMENHERE).split(',').map(s => s.trim()),
    SESSION_MAX_AGE: 24 * 60 * 60 * 1000,
    SSL_KEY_PATH: process.env.SSL_KEY_PATH || 'ssl/privkey.pem',
    SSL_CERT_PATH: process.env.SSL_CERT_PATH || 'ssl/cert.pem',
    SETUP_KEY: process.env.SETUP_KEY || 'secure-setup-key',
    DB_PATH: process.env.DB_PATH || './database.db',
    
    validate() {
        if (this.SESSION_SECRET === 'secret-key-change-in-production') {
            console.warn('WARNING: Using default SESSION_SECRET. Set SESSION_SECRET in .env');
        }
        console.log('CORS Origins:', this.CORS_ORIGINS);
    }
};
