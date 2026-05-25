-- משפחביט - בסיס נתונים (PostgreSQL)
-- טבלאות: משתמשים, תנועות

-- טבלת משתמשים
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT NOT NULL,
    avatar_url TEXT DEFAULT '',
    role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('admin', 'member')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- טבלת תנועות (הכל מתועד מול הקופה הראשית / מנהל)
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    type TEXT NOT NULL CHECK(type IN ('give', 'receive')),
    amount REAL NOT NULL CHECK(amount > 0),
    description TEXT DEFAULT '',
    receipt_url TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- אינדקסים
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(created_at);
