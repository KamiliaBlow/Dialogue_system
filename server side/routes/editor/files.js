// Медиафайлы редактора: списки и загрузка портретов, звуков, озвучки.
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { ASSETS_DIR, validateImageMagicBytes, validateAudioMagicBytes } = require('./shared');

module.exports = (db, upload) => {
    const router = express.Router();

    // ==================== ФАЙЛЫ ====================
    
    router.get('/files/portraits', (req, res) => {
        const portraitsDir = path.join(ASSETS_DIR, 'images/portraits');
        
        if (!fs.existsSync(portraitsDir)) {
            fs.mkdirSync(portraitsDir, { recursive: true });
            return res.json({ files: [] });
        }
        
        fs.readdir(portraitsDir, (err, files) => {
            if (err) {
                return res.json({ files: [] });
            }
            
            const imageFiles = files.filter(f => /\.(jpg|jpeg|png|gif|webp)$/i.test(f));
            res.json({ files: imageFiles.map(f => `/assets/images/portraits/${f}`) });
        });
    });

    router.get('/files/sounds', (req, res) => {
        const soundsDir = path.join(ASSETS_DIR, 'sounds/voices');
        
        if (!fs.existsSync(soundsDir)) {
            fs.mkdirSync(soundsDir, { recursive: true });
            return res.json({ files: [] });
        }
        
        fs.readdir(soundsDir, (err, files) => {
            if (err) {
                return res.json({ files: [] });
            }
            
            const soundFiles = files.filter(f => /\.(wav|mp3|ogg)$/i.test(f));
            res.json({ files: soundFiles.map(f => `/assets/sounds/voices/${f}`) });
        });
    });

    router.get('/files/voicelines', (req, res) => {
        const voicelinesDir = path.join(ASSETS_DIR, 'sounds/voiceline');
        
        if (!fs.existsSync(voicelinesDir)) {
            fs.mkdirSync(voicelinesDir, { recursive: true });
            return res.json({ files: [] });
        }
        
        fs.readdir(voicelinesDir, (err, files) => {
            if (err) {
                return res.json({ files: [] });
            }
            
            const soundFiles = files.filter(f => /\.(wav|mp3|ogg)$/i.test(f));
            res.json({ files: soundFiles.map(f => `/assets/sounds/voiceline/${f}`) });
        });
    });

// Загрузить портрет
    router.post('/files/upload-portrait', upload.single('portrait'), (req, res) => {
        if (!req.file) {
            return res.status(400).json({ message: 'Файл не загружен' });
        }

        if (!validateImageMagicBytes(req.file)) {
            try { fs.unlinkSync(req.file.path); } catch {}
            return res.status(400).json({ message: 'Файл не является корректным изображением' });
        }

        res.json({
            message: 'Файл загружен',
            path: `/assets/images/portraits/${req.file.filename}`,
            filename: req.file.filename
        });
    });

    router.post('/files/upload-sound', (req, res) => {
        const soundStorage = multer.diskStorage({
            destination: (req, file, cb) => {
                const uploadDir = path.join(ASSETS_DIR, 'sounds/voices');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = path.extname(file.originalname);
                cb(null, 'voice_' + uniqueSuffix + ext);
            }
        });
        
        const soundUpload = multer({
            storage: soundStorage,
            limits: { fileSize: 10 * 1024 * 1024 },
            fileFilter: (req, file, cb) => {
                const allowedExts = /\.(wav|mp3|ogg)$/i;
                const allowedMimes = /^(audio|video)\/(x-)?(wav|mpeg|mp3|ogg)$/i;
                if (allowedExts.test(path.extname(file.originalname).toLowerCase()) && allowedMimes.test(file.mimetype)) {
                    return cb(null, true);
                }
                cb(new Error('Только аудиофайлы разрешены'));
            }
        });

        soundUpload.single('sound')(req, res, (err) => {
            if (err) {
                return res.status(400).json({ message: err.message });
            }
            if (!req.file) {
                return res.status(400).json({ message: 'Файл не загружен' });
            }

            if (!validateAudioMagicBytes(req.file)) {
                try { fs.unlinkSync(req.file.path); } catch {}
                return res.status(400).json({ message: 'Файл не является корректным аудиофайлом' });
            }

            res.json({
                message: 'Файл загружен',
                path: `/assets/sounds/voices/${req.file.filename}`,
                filename: req.file.filename
            });
        });
    });

    router.post('/files/upload-voiceline', (req, res) => {
        const voicelineStorage = multer.diskStorage({
            destination: (req, file, cb) => {
                const uploadDir = path.join(ASSETS_DIR, 'sounds/voiceline');
                if (!fs.existsSync(uploadDir)) {
                    fs.mkdirSync(uploadDir, { recursive: true });
                }
                cb(null, uploadDir);
            },
            filename: (req, file, cb) => {
                const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                const ext = path.extname(file.originalname);
                cb(null, 'voiceline_' + uniqueSuffix + ext);
            }
        });
        
        const voicelineUpload = multer({
            storage: voicelineStorage,
            limits: { fileSize: 50 * 1024 * 1024 },
            fileFilter: (req, file, cb) => {
                const allowedExts = /\.(wav|mp3|ogg)$/i;
                const allowedMimes = /^(audio|video)\/(x-)?(wav|mpeg|mp3|ogg)$/i;
                if (allowedExts.test(path.extname(file.originalname).toLowerCase()) && allowedMimes.test(file.mimetype)) {
                    return cb(null, true);
                }
                cb(new Error('Только аудиофайлы разрешены'));
            }
        });

        voicelineUpload.single('voiceline')(req, res, (err) => {
            if (err) {
                return res.status(400).json({ message: err.message });
            }
            if (!req.file) {
                return res.status(400).json({ message: 'Файл не загружен' });
            }

            if (!validateAudioMagicBytes(req.file)) {
                try { fs.unlinkSync(req.file.path); } catch {}
                return res.status(400).json({ message: 'Файл не является корректным аудиофайлом' });
            }

            res.json({ 
                message: 'Файл загружен',
                path: `/assets/sounds/voiceline/${req.file.filename}`,
                filename: req.file.filename
            });
        });
    });

    return router;
};
