require('dotenv').config();

module.exports = {
    PORT: process.env.PORT || 3000,
    SESSION_SECRET: process.env.SESSION_SECRET || 'pmNGC(q,]t,z01l/[G3/aN:;:a/w4–[A',
    CORS_ORIGINS: (process.env.CORS_ORIGINS || 'https://v13.necrocow.ru,https://www.v13.necrocow.ru').split(',').map(s => s.trim()),
    SESSION_MAX_AGE: 24 * 60 * 60 * 1000,
    SSL_KEY_PATH: process.env.SSL_KEY_PATH || 'ssl/privkey.pem',
    SSL_CERT_PATH: process.env.SSL_CERT_PATH || 'ssl/cert.pem',
    SETUP_KEY: process.env.SETUP_KEY || '218ET:<_aS?7v[COht9xAnt?tLnYmUTI',
    DB_PATH: process.env.DB_PATH || './database.db',
    
    validate() {
        if (this.SESSION_SECRET === 'gms4521-terminal-secret-key') {
            console.warn('WARNING: Using default SESSION_SECRET. Set SESSION_SECRET in .env');
        }
        if (this.SETUP_KEY === 'gms4521-setup-key') {
            console.warn('WARNING: Using default SETUP_KEY. Set SETUP_KEY in .env');
        }
    }
};
