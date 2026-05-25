const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'mishpachat.db');

// Open database
const db = new sqlite3.Database(DB_PATH);

// Promisify db methods
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ lastID: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Initialize schema
async function initDb() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    const statements = schema.split(';').filter(s => s.trim());
    for (const stmt of statements) {
        await run(stmt);
    }
    console.log('✅ Database initialized:', DB_PATH);
}

// ---- USER FUNCTIONS ----

async function createUser(username, password, displayName, role = 'member', avatarUrl = '') {
    const hash = bcrypt.hashSync(password, 10);
    try {
        const result = await run(
            'INSERT INTO users (username, password_hash, display_name, role, avatar_url) VALUES (?, ?, ?, ?, ?)',
            [username, hash, displayName, role, avatarUrl]
        );
        return { id: result.lastID, username, display_name: displayName, role };
    } catch (e) {
        if (e.message.includes('UNIQUE') || e.message.includes('unique')) {
            return { error: 'שם המשתמש כבר קיים' };
        }
        throw e;
    }
}

async function authenticateUser(username, password) {
    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    if (!user) return null;
    if (!bcrypt.compareSync(password, user.password_hash)) return null;
    return { id: user.id, username: user.username, display_name: user.display_name, role: user.role, avatar_url: user.avatar_url };
}

async function getUserById(id) {
    return await get('SELECT id, username, display_name, role, avatar_url, created_at FROM users WHERE id = ?', [id]);
}

async function getAllMembers() {
    return await all("SELECT id, username, display_name, role, avatar_url FROM users WHERE role = 'member' ORDER BY display_name");
}

async function getAllUsers() {
    return await all('SELECT id, username, display_name, role, avatar_url FROM users ORDER BY role, display_name');
}

// ---- BALANCE FUNCTIONS ----

async function getUserBalance(userId) {
    const received = await get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'receive'", [userId]);
    const given = await get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'give'", [userId]);
    return given.total - received.total;
}

async function getFullBalance(userId) {
    const received = await get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'receive'", [userId]);
    const given = await get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = ? AND type = 'give'", [userId]);
    return {
        given: received.total,
        received: given.total,
        balance: given.total - received.total
    };
}

async function getAdminDashboard() {
    const members = await getAllMembers();
    const dashboard = [];
    let totalOwed = 0;
    for (const m of members) {
        const bal = await getFullBalance(m.id);
        // balance > 0 means member owes money (gave more than received)
        if (bal.balance > 0) totalOwed += bal.balance;
        dashboard.push({
            ...m,
            balance: bal.balance,
            total_given: bal.given,
            total_received: bal.received
        });
    }
    return { members: dashboard, total_owed: totalOwed };
}

// ---- TRANSACTION FUNCTIONS ----

async function addTransaction(userId, type, amount, description = '') {
    const result = await run(
        'INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)',
        [userId, type, parseFloat(amount), description]
    );
    const balance_after = await getUserBalance(userId);
    return {
        id: result.lastID,
        user_id: userId,
        type,
        amount: parseFloat(amount),
        description,
        balance_after
    };
}

async function getUserTransactions(limit = 50) {
    return await all(
        'SELECT t.*, u.display_name FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT ?',
        [limit]
    );
}

async function getMyTransactions(userId, limit = 50) {
    return await all(
        'SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
        [userId, limit]
    );
}

// ---- SEED DATA ----

async function seedIfEmpty() {
    const count = await get('SELECT COUNT(*) as c FROM users');
    if (!count || count.c === 0) {
        console.log('🌱 Seeding initial data...');
        await createUser('admin', 'admin123', 'מנהל המשפחה', 'admin');
        await createUser('yossi', '1234', 'יוסי', 'member');
        await createUser('dana', '1234', 'דנה', 'member');
        await createUser('noam', '1234', 'נועם', 'member');

        await addTransaction(2, 'receive', 500, 'הפקדת חודשית');
        await addTransaction(2, 'give', 200, 'קניית מצרכים');
        await addTransaction(3, 'receive', 300, 'הפקדה');
        await addTransaction(3, 'give', 150, 'הוצאות בית ספר');
        await addTransaction(4, 'receive', 400, 'הפקדת חודשית');
        await addTransaction(2, 'give', 100, 'חופשה');

        console.log('✅ Seed data created');
        console.log('   Admin: admin / admin123');
        console.log('   Members: yossi / 1234, dana / 1234, noam / 1234');
    }
}

// Initialize and seed
initDb().then(() => seedIfEmpty()).catch(err => {
    console.error('DB init error:', err);
    process.exit(1);
});

module.exports = {
    db, run, get, all,
    createUser, authenticateUser, getUserById, getAllMembers, getAllUsers,
    getUserBalance, getFullBalance, getAdminDashboard,
    addTransaction, getUserTransactions, getMyTransactions
};
