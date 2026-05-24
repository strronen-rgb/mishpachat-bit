# 👨‍👩‍👧‍👦 משפחביט

אפליקציית ניהול כספים משפחתית — מעקב אחר תנועות כספים בין בני המשפחה לקופה הראשית.

## הפעלה

```bash
cd /root/projects/mishpachat-bit
npm install
node server.js
# או
bash start.sh
```

פתח בדפדפן: `http://localhost:3000`

## התחברות ראשונית

- **מנהל:** `admin` / `admin123`
- **בני משפחה:** `yossi` / `1234`, `dana` / `1234`, `noam` / `1234`

## מבנה הפרויקט

```
mishpachat-bit/
├── server.js          # Express server + API
├── database.js        # SQLite DB + queries
├── schema.sql         # DB schema
├── package.json
├── start.sh
├── public/
│   └── index.html     # Frontend (SPA)
└── mishpachat.db      # SQLite database
```

## API

| Method | Path | תיאור |
|--------|------|-------|
| POST | `/api/login` | התחברות |
| GET | `/api/me` | פרטי משתמש נוכחי |
| GET | `/api/member/balance` | אלאנס אישי |
| GET | `/api/member/transactions` | היסטוריה אישית |
| POST | `/api/member/transaction` | הוספת תנועה |
| GET | `/api/admin/dashboard` | לוח בקרה מנהל |
| GET | `/api/admin/transactions` | כל התנועות |
| POST | `/api/admin/user` | הוספת משתמש |
| DELETE | `/api/admin/user/:id` | מחיקת משתמש |

## תכונות

- 🔐 מערכת התחברות עם JWT
- 👤 מנהל רואה הכל, משתמש רואה רק את עצמו
- 💸 תנועות "נתתי לקופה" / "קיבלתי מהקופה"
- 📋 היסטוריה מלאה של כל התנועות
- 📊 Dashboard למנהל עם סיכום
- 🎨 ממשק יפה ורספונסיבי
- 🗄️ SQLite DB מקומי
