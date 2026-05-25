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
    limits: { fileSize: 5 * 1024 * 1024 },
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

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await db.authenticateUser(username, password);
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
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

app.get('/api/me', requireAuth, async (req, res) => {
    try {
        const user = await db.getUserById(req.user.id);
        const balance = await db.getFullBalance(req.user.id);
        res.json({ user, balance });
    } catch (err) {
        console.error('Me error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

// ---- AVATAR ROUTES ----

app.post('/api/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'לא הועלתה תמונה' });
        const user = await db.getUserById(req.user.id);
        if (user && user.avatar_url) {
            const oldPath = path.join(__dirname, 'public', user.avatar_url);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        const avatarUrl = '/avatars/' + req.file.filename;
        await db.run('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, req.user.id]);
        res.json({ success: true, avatar_url: avatarUrl });
    } catch (err) {
        console.error('Avatar upload error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

app.post('/api/admin/avatar/:userId', requireAuth, requireAdmin, upload.single('avatar'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'לא הועלתה תמונה' });
        const userId = parseInt(req.params.userId);
        const user = await db.getUserById(userId);
        if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
        if (user.avatar_url) {
            const oldPath = path.join(__dirname, 'public', user.avatar_url);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
        }
        const avatarUrl = '/avatars/' + req.file.filename;
        await db.run('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, userId]);
        res.json({ success: true, avatar_url: avatarUrl });
    } catch (err) {
        console.error('Admin avatar upload error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

// ---- MEMBER ROUTES ----

app.get('/api/member/balance', requireAuth, async (req, res) => {
    try {
        const balance = await db.getFullBalance(req.user.id);
        res.json(balance);
    } catch (err) {
        console.error('Balance error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

app.get('/api/member/transactions', requireAuth, async (req, res) => {
    try {
        const transactions = await db.getMyTransactions(req.user.id, 100);
        res.json(transactions);
    } catch (err) {
        console.error('Transactions error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

app.post('/api/member/transaction', requireAuth, async (req, res) => {
    try {
        const { type, amount, description } = req.body;
        if (!type || !amount) return res.status(400).json({ error: 'חוסר נתונים' });
        if (!['give', 'receive'].includes(type)) return res.status(400).json({ error: 'סוג תנועה לא תקיף' });
        if (parseFloat(amount) <= 0) return res.status(400).json({ error: 'סכום חייב להיות חיובי' });
        // Members can only deposit (receive type). Withdrawals require admin.
        if (type === 'give') {
            return res.status(403).json({ error: 'משיכה מהקופה דורשת אישור מנהל בלבד' });
        }
        const result = await db.addTransaction(req.user.id, type, parseFloat(amount), description || '');
        res.json({ success: true, transaction: result });
    } catch (err) {
        console.error('Transaction error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

app.post('/api/admin/transaction/:userId', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { type, amount, description } = req.body;
        const userId = parseInt(req.params.userId);
        if (!type || !amount) return res.status(400).json({ error: 'חוסר נתונים' });
        if (parseFloat(amount) <= 0) return res.status(400).json({ error: 'סכום חייב להיות חיובי' });
        const result = await db.addTransaction(userId, type, parseFloat(amount), description || '');
        res.json({ success: true, transaction: result });
    } catch (err) {
        console.error('Admin transaction error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

// Upload receipt for a transaction
const receiptUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, 'public', 'receipts');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const ext = path.extname(file.originalname).toLowerCase();
            cb(null, `receipt_${req.params.txnId}_${Date.now()}${ext}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('סוג קובץ לא נתמך'));
    }
});

app.post('/api/transaction/:txnId/receipt', requireAuth, receiptUpload.single('receipt'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'לא הועלה קובץ' });
        const txnId = parseInt(req.params.txnId);
        const receiptUrl = '/receipts/' + req.file.filename;
        await db.run('UPDATE transactions SET receipt_url = $1 WHERE id = $2 AND user_id = $3', [receiptUrl, txnId, req.user.id]);
        res.json({ success: true, receipt_url: receiptUrl });
    } catch (err) {
        console.error('Receipt upload error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

// ---- ADMIN ROUTES ----

app.get('/api/admin/dashboard', requireAuth, requireAdmin, async (req, res) => {
    try {
        const dashboard = await db.getAdminDashboard();
        res.json(dashboard);
    } catch (err) {
        console.error('Dashboard error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

app.get('/api/admin/transactions', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { userId } = req.query;
        if (userId) {
            const transactions = await db.getMyTransactions(parseInt(userId), 100);
            const user = await db.getUserById(parseInt(userId));
            res.json({ transactions, user });
        } else {
            const transactions = await db.getUserTransactions(100);
            res.json({ transactions, user: null });
        }
    } catch (err) {
        console.error('Admin transactions error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

app.post('/api/admin/user', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { username, password, display_name } = req.body;
        if (!username || !password || !display_name) {
            return res.status(400).json({ error: 'חוסר נתונים' });
        }
        const result = await db.createUser(username, password, display_name, 'member');
        if (result.error) return res.status(400).json({ error: result.error });
        res.json({ success: true, user: result });
    } catch (err) {
        console.error('Create user error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

app.put('/api/admin/user/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const user = await db.getUserById(parseInt(req.params.id));
        if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
        if (user.role === 'admin') return res.status(400).json({ error: 'לא ניתן לערוך מנהל' });
        const { username, display_name, password } = req.body;
        if (!username || !display_name) return res.status(400).json({ error: 'חוסר נתונים' });
        if (password) {
            const bcrypt = require('bcryptjs');
            const hash = bcrypt.hashSync(password, 10);
            await db.run('UPDATE users SET username = $1, display_name = $2, password_hash = $3 WHERE id = $4', [username, display_name, hash, parseInt(req.params.id)]);
        } else {
            await db.run('UPDATE users SET username = $1, display_name = $2 WHERE id = $3', [username, display_name, parseInt(req.params.id)]);
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Update user error:', err);
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'שם המשתמש כבר קיים' });
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

app.delete('/api/admin/user/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const user = await db.getUserById(parseInt(req.params.id));
        if (!user) return res.status(404).json({ error: 'משתמש לא נמצא' });
        if (user.role === 'admin') return res.status(400).json({ error: 'לא ניתן למחוק מנהל' });
        if (user.avatar_url) {
            const avatarPath = path.join(__dirname, 'public', user.avatar_url);
            if (fs.existsSync(avatarPath)) fs.unlinkSync(avatarPath);
        }
        await db.run('DELETE FROM users WHERE id = $1', [parseInt(req.params.id)]);
        res.json({ success: true });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: 'שגיאת שרת' });
    }
});

// ---- START SERVER ----

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 משפחביט running on http://0.0.0.0:${PORT}`);
    console.log(`   Admin login: admin / admin123`);
});

module.exports = app;
