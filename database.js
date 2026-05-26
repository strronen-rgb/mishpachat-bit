const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

// PostgreSQL connection via DATABASE_URL (Neon)
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Promisify-style query helpers
async function run(sql, params = []) {
    const result = await pool.query(sql, params);
    return { lastID: result.rows[0]?.id || null, changes: result.rowCount };
}

async function get(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows[0] || null;
}

async function all(sql, params = []) {
    const result = await pool.query(sql, params);
    return result.rows;
}

// Initialize schema
async function initDb() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    // Split on semicolons but skip empty statements
    const statements = schema.split(';').map(s => s.trim()).filter(s => s.length > 10);
    for (const stmt of statements) {
        try {
            await pool.query(stmt);
        } catch (err) {
            // Skip "already exists" errors
            if (!err.message.includes('already exists')) {
                console.warn('Schema init warning:', err.message);
            }
        }
    }
    console.log('✅ Database initialized (PostgreSQL/Neon)');
}

// ---- USER FUNCTIONS ----

async function createUser(username, password, displayName, role = 'member', avatarUrl = '') {
    const hash = bcrypt.hashSync(password, 10);
    try {
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, display_name, role, avatar_url) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [username, hash, displayName, role, avatarUrl]
        );
        const id = result.rows[0].id;
        return { id, username, display_name: displayName, role };
    } catch (e) {
        if (e.message.includes('unique') || e.message.includes('UNIQUE') || e.code === '23505') {
            return { error: 'שם המשתמש כבר קיים' };
        }
        throw e;
    }
}

async function authenticateUser(username, password) {
    const user = await get('SELECT * FROM users WHERE username = $1', [username]);
    if (!user) return null;
    if (!bcrypt.compareSync(password, user.password_hash)) return null;
    return { id: user.id, username: user.username, display_name: user.display_name, role: user.role, avatar_url: user.avatar_url };
}

async function getUserById(id) {
    return await get('SELECT id, username, display_name, role, avatar_url, created_at FROM users WHERE id = $1', [id]);
}

async function getAllMembers() {
    return await all("SELECT id, username, display_name, role, avatar_url FROM users WHERE role = 'member' ORDER BY display_name");
}

async function getAllUsers() {
    return await all('SELECT id, username, display_name, role, avatar_url FROM users ORDER BY role, display_name');
}

// ---- BALANCE FUNCTIONS ----

async function getUserBalance(userId) {
    const received = await get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'receive'", [userId]);
    const given = await get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'give'", [userId]);
    return given.total - received.total;
}

async function getFullBalance(userId) {
    const received = await get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'receive'", [userId]);
    const given = await get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'give'", [userId]);
    return {
        given: received.total,
        received: given.total,
        balance: given.total - received.total
    };
}

async function getFamilyDebt(userId) {
    const received = await get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'receive'", [userId]);
    const given = await get("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE user_id = $1 AND type = 'give'", [userId]);
    return {
        totalReceived: received.total,
        totalGiven: given.total,
        balance: given.total - received.total
    };
}

async function getAdminDashboard() {
    const members = await getAllMembers();
    const dashboard = [];
    let totalOwed = 0;
    for (const m of members) {
        const bal = await getFullBalance(m.id);
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
    const result = await pool.query(
        'INSERT INTO transactions (user_id, type, amount, description) VALUES ($1, $2, $3, $4) RETURNING id',
        [userId, type, parseFloat(amount), description]
    );
    const id = result.rows[0].id;
    const balance_after = await getUserBalance(userId);
    return {
        id,
        user_id: userId,
        type,
        amount: parseFloat(amount),
        description,
        balance_after
    };
}

async function getUserTransactions(limit = 50) {
    return await all(
        'SELECT t.*, u.display_name FROM transactions t JOIN users u ON t.user_id = u.id ORDER BY t.created_at DESC LIMIT $1',
        [limit]
    );
}

async function getMyTransactions(userId, limit = 50) {
    return await all(
        'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
        [userId, limit]
    );
}

// ---- SEED DATA ----

async function seedIfEmpty() {
    const count = await get('SELECT COUNT(*) as c FROM users');
    if (!count || parseInt(count.c) === 0) {
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
    pool, run, get, all,
    createUser, authenticateUser, getUserById, getAllMembers, getAllUsers,
    getUserBalance, getFullBalance, getFamilyDebt, getAdminDashboard,
    addTransaction, getUserTransactions, getMyTransactions
};
