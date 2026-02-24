const config = require('../config');

class Logger {
    static formatMessage(level, message, data = null) {
        const timestamp = new Date().toISOString();
        const logData = data ? ` | ${JSON.stringify(data)}` : '';
        return `[${timestamp}] [${level}] ${message}${logData}`;
    }
    
    static info(message, data = null) {
        console.log(this.formatMessage('INFO', message, data));
    }
    
    static warn(message, data = null) {
        console.warn(this.formatMessage('WARN', message, data));
    }
    
    static error(message, data = null) {
        console.error(this.formatMessage('ERROR', message, data));
    }
    
    static request(req, res, next) {
        const start = Date.now();
        
        res.on('finish', () => {
            const duration = Date.now() - start;
            Logger.info(`${req.method} ${req.originalUrl}`, {
                status: res.statusCode,
                duration: `${duration}ms`,
                ip: req.ip
            });
        });
        
        next();
    }
}

module.exports = Logger;
