const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'mishpachat.db');
const db = new Database(DB_PATH);

// WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Initialize schema
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

console.log('✅ Database initialized:', DB_PATH);

// ---- USER FUNCTIONS ----

function createUser(username, password, displayName, role = 'member', avatarUrl = '') {
    const hash = bcrypt.hashSync(password, 10);
    const stmt = db.prepare(
        'INSERT INTO users (username, password_hash, display_name, role, avatar_url) VALUES (?, ?, ?, ?, ?)'
    );
    try {
        const result = stmt.run(username, hash, displayName, role, avatarUrl);
        return { id: result.lastInsertRowid, username, display_name: displayName, role };
    } catch (e) {
        if (e.message.includes('UNIQUE')) {
            return { error: 'שם המשתמש כבר קיים' };
        }
        throw e;
    }
}

function authenticateUser(username, password) {
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return null;
    if (!bcrypt.compareSync(password, user.password_hash)) return null;
    return { id: user.id, username: user.username, display_name: user.display_name, role: user.role, avatar_url: user.avatar_url };
}

function getUserById(id) {
    return db.prepare('SELECT id, username, display_name, role, avatar_url, created_at FROM users WHERE id = ?').get(id);
}

function getAllMembers() {
    return db.prepare("SELECT id, username, display_name, role, avatar_url FROM users WHERE role = 'member' ORDER BY display_name").all();
}

function getAllUsers() {
    return db.prepare('SELECT id, username, display_name, role, avatar_url FROM users ORDER BY role, display_name').all();
}

// ---- BALANCE FUNCTIONS ----

function getUserBalance(userId) {
    const received = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'receive'"
    ).get(userId).total;
    const given = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'give'"
    ).get(userId).total;
    return given - received; // positive = חייב לקופה, negative = הקופה חייבה לו
}

function getFullBalance(userId) {
    const received = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'receive'"
    ).get(userId).total;
    const given = db.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'give'"
    ).get(userId).total;
    return {
        given: received,      // כמה נתן לקופה
        received: given,       // כמה קיבל מהקופה
        balance: given - received  // אלאנס נטו
    };
}

function getAdminDashboard() {
    const members = getAllMembers();
    const dashboard = members.map(m => {
        const bal = getFullBalance(m.id);
        return {
            ...m,
            balance: bal.balance,
            total_given: bal.given,
            total_received: bal.received
        };
    });
    const totalOwed = dashboard.reduce((sum, m) => sum + Math.max(0, m.balance), 0);
    return { members: dashboard, total_owed: totalOwed };
}

// ---- TRANSACTION FUNCTIONS ----

function addTransaction(userId, type, amount, description = '') {
    const stmt = db.prepare(
        'INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)'
    );
    const result = stmt.run(userId, type, parseFloat(amount), description);
    return {
        id: result.lastInsertRowid,
        user_id: userId,
        type,
        amount: parseFloat(amount),
        description,
        balance_after: getUserBalance(userId)
    };
}

function getUserTransactions(limit = 50) {
    return db.prepare(
        'SELECT t.*, u.display_name FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT ?'
    ).all(limit);
}

function getMyTransactions(userId, limit = 50) {
    return db.prepare(
        'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(userId, limit);
}

// ---- SEED DATA ----

function seedIfEmpty() {
    const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
    if (count.c === 0) {
        console.log('🌱 Seeding initial data...');
        createUser('admin', 'admin123', 'מנהל המשפחה', 'admin');
        createUser('yossi', '1234', 'יוסי', 'member');
        createUser('dana', '1234', 'דנה', 'member');
        createUser('noam', '1234', 'נועם', 'member');

        // Some sample transactions
        addTransaction(2, 'receive', 500, 'הפקדת חודשית');
        addTransaction(2, 'give', 200, 'קניית מצרכים');
        addTransaction(3, 'receive', 300, 'הפקדה');
        addTransaction(3, 'give', 150, 'הוצאות בית ספר');
        addTransaction(4, 'receive', 400, 'הפקדת חודשית');
        addTransaction(2, 'give', 100, 'חופשה');

        console.log('✅ Seed data created');
        console.log('   Admin: admin / admin123');
        console.log('   Members: yossi / 1234, dana / 1234, noam / 1234');
    }
}

seedIfEmpty();

module.exports = {
    db,
    createUser,
    authenticateUser,
    getUserById,
    getAllMembers,
    getAllUsers,
    getUserBalance,
    getFullBalance,
    getAdminDashboard,
    addTransaction,
    getUserTransactions,
    getMyTransactions
};
