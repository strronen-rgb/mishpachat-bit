const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'mishpachat-bit-secret-key-2026';

// ---- AVATAR UPLOAD SETUP ----
const uploadDir = path.join(__dirname, 'public', 'avatars');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const safeExt = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext) ? ext : '.png';
        cb(null, `avatar_${req.user.id}_${Date.now()}${safeExt}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('סוג קובץ לא נתמך'));
    }
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/avatars', express.static(uploadDir));

// ---- AUTH MIDDLEWARE ----

function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'נדרשת התחברות' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'טוקן לא תקיף' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'אין הרשאת מנהל' });
    }
    next();
}

// ---- AUTH ROUTES ----

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    const user = db.authenticateUser(username, password);
    if (!user) {
        return res.status(401).json({ error: 'שם משתמש או סיסמה שגויים' });
    }
    const token = jwt.sign(
        { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
        JWT_SECRET,
        { expiresIn: '30d' }
    );
    res.json({
        token,
        user: {
            id: user.id,
            username: user.username,
            display_name: user.display_name,
            role: user.role,
            avatar_url: user.avatar_url
        }
    });
});

app.get('/api/me', requireAuth, (req, res) => {
    const user = db.getUserById(req.user.id);
    const balance = db.getFullBalance(req.user.id);
    res.json({ user, balance });
});

// ---- AVATAR ROUTES ----

// Upload avatar for self (member)
app.post('/api/avatar', requireAuth, upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'לא הועלתה תמונה' });

    // Delete old avatar if exists
    const user = db.getUserById(req.user.id);
    if (user.avatar_url) {
        const oldPath = path.join(__dirname, 'public', user.avatar_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const avatarUrl = '/avatars/' + req.file.filename;
    db.db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, req.user.id);

    res.json({ success: true, avatar_url: avatarUrl });
});

// Upload avatar for any user (admin only)
app.post('/api/admin/avatar/:userId', requireAuth, requireAdmin, upload.single('avatar'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'לא הועלתה תמונה' });
    const userId = parseInt(req.params.userId);

    const user = db.getUserById(userId);
    if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });

    if (user.avatar_url) {
        const oldPath = path.join(__dirname, 'public', user.avatar_url);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    const avatarUrl = '/avatars/' + req.file.filename;
    db.db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(avatarUrl, userId);

    res.json({ success: true, avatar_url: avatarUrl });
});

// ---- MEMBER ROUTES ----

app.get('/api/member/balance', requireAuth, (req, res) => {
    const balance = db.getFullBalance(req.user.id);
    res.json(balance);
});

app.get('/api/member/transactions', requireAuth, (req, res) => {
    const transactions = db.getMyTransactions(req.user.id, 100);
    res.json(transactions);
});

app.post('/api/member/transaction', requireAuth, (req, res) => {
    const { type, amount, description } = req.body;
    if (!type || !amount) return res.status(400).json({ error: 'חוסר נתונים' });
    if (!['give', 'receive'].includes(type)) return res.status(400).json({ error: 'סוג תנועה לא תקיף' });
    if (parseFloat(amount) <= 0) return res.status(400).json({ error: 'סכום חייב להיות חיובי' });
    const result = db.addTransaction(req.user.id, type, parseFloat(amount), description || '');
    res.json({ success: true, transaction: result });
});

// Admin can add transaction for any user
app.post('/api/admin/transaction/:userId', requireAuth, requireAdmin, (req, res) => {
    const { type, amount, description } = req.body;
    const userId = parseInt(req.params.userId);
    if (!type || !amount) return res.status(400).json({ error: 'חוסר נתונים' });
    if (parseFloat(amount) <= 0) return res.status(400).json({ error: 'סכום חייב להיות חיובי' });
    const result = db.addTransaction(userId, type, parseFloat(amount), description || '');
    res.json({ success: true, transaction: result });
});

// ---- ADMIN ROUTES ----

app.get('/api/admin/dashboard', requireAuth, requireAdmin, (req, res) => {
    const dashboard = db.getAdminDashboard();
    res.json(dashboard);
});

app.get('/api/admin/transactions', requireAuth, requireAdmin, (req, res) => {
    const transactions = db.getUserTransactions(100);
    res.json(transactions);
});

app.post('/api/admin/user', requireAuth, requireAdmin, (req, res) => {
    const { username, password, display_name } = req.body;
    if (!username || !password || !display_name) {
        return res.status(400).json({ error: 'חוסר נתונים' });
    }
    const result = db.createUser(username, password, display_name, 'member');
    if (result.error) return res.status(400).json({ error: result.error });
    res.json({ success: true, user: result });
});

app.delete('/api/admin/user/:id', requireAuth, requireAdmin, (req, res) => {
    const user = db.getUserById(parseInt(req.params.id));
    if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
    if (user.role === 'admin') return res.status(400).json({ error: 'לא ניתן למחוק מנהל' });
    // Delete avatar file
    if (user.avatar_url) {
        const avatarPath = path.join(__dirname, 'public', user.avatar_url);
        if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
    }
    db.db.prepare('DELETE FROM users WHERE id = ?').run(parseInt(req.params.id));
    res.json({ success: true });
});

// ---- START SERVER ----

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 משפחביט running on http://0.0.0.0:${PORT}`);
    console.log(`   Admin login: admin / admin123`);
});

module.exports = app;
