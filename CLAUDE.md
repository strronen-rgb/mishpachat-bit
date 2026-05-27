# CLAUDE.md — משפחביט (MishpachatBit)

## סקירה כללית
אפליקציית ניהול כספים משפחתית — מערכת למעקב אחר הפקדות ומשיכות מקופה משפחתית מרכזית.

- **URL ב-Render:** (מוגדר ב-Render Dashboard)
- **בסיס נתונים:** PostgreSQL דרך Neon
- **טכנולוגיות:** Node.js + Express + ונילה HTML/CSS/JS (ללא React, ללא build step)
- **שפה:** עברית (RTL)

## ⚠️ כלל קריטי: אישור לפני דיפלוי
**לפני כל `git push`, `git commit`, או הפעלת deploy ל-Render — חייב לבקש אישור מהמשתמש (רונן).**
- אסור לדחוף קוד ל-GitHub בלי אישור מפורש
- אסור להפעיל deploy ל-Render בלי אישור מפורש
- אם המשתמש לא ענה/לא אישר — המתן, אל תדחוף
- משתמש הוא רונן בלבד; אין אישור אוטומטי

## מבנה קבצים

```
├── server.js          — Express API (auth, transactions, admin, avatars, receipts)
├── database.js        — PostgreSQL/Neon data access layer (כל השאילתות)
├── schema.sql         — מבנה בסיס נתונים (users, transactions, withdrawal_requests)
├── render.yaml        — הגדרות פרסום Render (auto-generates JWT_SECRET)
├── package.json       — dependencies (express, pg, bcryptjs, jsonwebtoken, multer, cors)
└── public/
    └── index.html     — SPA מלא (login, member view, admin dashboard, modals)
```

## פיצ'רים עיקריים

### מערכת התחברות
- JWT-based authentication
- שני תפקידים: `admin` ו-`member`
- סיסמאות מוצפנות עם bcrypt

### תפקיד מנהל (Admin)
- הוספת/עריכת/מחיקת משתמשים
- רשימת כל חברי המשפחה עם יתרות
- יצירת תנועות (הפקדות ומשיכות) בשם חברי המשפחה
- אישור/דחיית בקשות משיכה
- העלאת קבצים (אווטרים וקבלות)

### תפקיד חבר משפחה (Member)
- צפייה ביתרה אישית
- צפייה בהיסטוריית תנועות
- בקשת הפקדה (receive) — מאושרת מיידית
- בקשת משיכה (give/widrawal) — דורשת אישור מנהל

## לוגיקת יתרות (חשוב!)

### סוגי תנועות
| type DB | משמעות | השפעה על יתרה | צבע UI |
|---------|---------|----------------|--------|
| `receive` | **הפקדה** — הקופה נותנת כסף לחבר משפחה | חבר המשפחה **חייב** לקופה (יתרה עולה +) | 🔴 אדום |
| `give` | **משיכה** — הקופה מחזירה כסף לחבר משפחה | **מפחיתה חוב** (יתרה יורדת −) | 🟢 ירוק |

### נוסחת חישוב
```
balance = SUM(receive amounts) - SUM(give amounts)
       = deposits - withdrawals
```

- **יתרה חיובית (+)** = חבר המשפחה חייב לקופה
- **יתרה שלילית (−)** = הקופה חייבת לחבר המשפחה

### טרמינולוגיה ב-UI
- "הפקקות" = סכום שהקופה נתנה (חוב) — צבע אדום
- "משיכות" = סכום שהקופה החזירה (זכות) — צבע ירוק
- יתרה חיובית → "חייב לקופה"
- יתרה שלילית → "הקופה חייבת לך"

## API Endpoints

### Authentication
| Method | Path | תיאור |
|--------|------|--------|
| POST | `/api/auth/login` | התחברות (מחזיר JWT) |
| POST | `/api/auth/register` | הרשמה (ל-members בלבד) |
| GET | `/api/auth/me` | פרטי משתמש מחובר |

### Transactions
| Method | Path | תיאור |
|--------|------|--------|
| POST | `/api/transactions` | הוספת תנועה (receive=הפקדה מיידית, give דורש אישור) |
| GET | `/api/transactions/my` | היסטוריית תנועות אישית |
| GET | `/api/transactions/all` | כל התנועות (admin) |
| GET | `/api/transactions/full-balance` | יתרא מלאה של חבר משפחה |

### Admin
| Method | Path | תיאור |
|--------|------|--------|
| GET | `/api/admin/dashboard` | דשבורד (stats + סיכום) |
| GET | `/api/admin/users` | רשימת משתמשים |
| POST | `/api/admin/users` | הוספת משתמש |
| PUT | `/api/admin/users/:id` | עריכת משתמש |
| DELETE | `/api/admin/users/:id` | מחיקת משתמש |
| POST | `/api/admin/transactions` | יצירת תנועה בשם משתמש |
| GET | `/api/admin/withdrawals` | בקשות משיכה ממתינות |
| POST | `/api/admin/withdrawals/:id/approve` | אישור משיכה |
| POST | `/api/admin/withdrawals/:id/reject` | דחיית משיכה |

### קבצים
| Method | Path | תיאור |
|--------|------|--------|
| POST | `/api/avatars` | העלאת אווטר |
| POST | `/api/receipts` | העלאת קבלה |
| GET | `/uploads/:filename` | שליפת קובץ שהועלה |

## משתני סביבה
| משתנה | חובה | הערה |
|--------|------|-------|
| `DATABASE_URL` | ✅ | connection string של Neon PostgreSQL |
| `JWT_SECRET` | ✅ | Render auto-generates דרך `render.yaml` |
| `PORT` | ✗ | ברירת מחדל: 3000 |

## פרסום ל-Render
- `render.yaml` מגדיר את השירות
- Render auto-generates `JWT_SECRET`
- Auto-deploy לא אמין — משתמשים ב-API לטריגר deploy:
  ```
  POST https://api.render.com/v1/services/{SERVICE_ID}/deploys
  Authorization: Bearer {RENDER_API_KEY}
  ```
- `TMPDIR=/var/tmp` — חובה לפני `npm install` (בגלל tmpfs בקונטיינר)

## אבטחה (יישומים קיימים)
- **JWT secret** — אין ברירת מחדל, האפליקציה קורסת אם חסר
- **escapeHtml()** — מופעל על כל נקודות innerHTML עם נתוני משתמש
- **Rate limiting** — 100 בקשות/15 דקות לכל IP
- **Body size limit** — 1MB מקסימום
- **CSP headers** — מוגדרים (עם unsafe-inline/unsafe-eval בגלל inline scripts)
- **bcrypt** — הצפנת סיסמאות

## הערות חשובות לפיתוע
1. `database.js` — פונקציות DB משתמשות ב-`pool.query()` ולא בסינטקס `client.query()`
2. `index.html` — SPA מלא, כל ה-UI בקובץ אחד (כולל CSS ו-JS)
3. אין build step — `node server.js` ישירות
4. קבצי העלאה נשמרים ב-`./uploads/` (נדרש `mkdir -p uploads`)
5. העלאת קבלות תכולה בשדה `receipt_url` בטבלת transactions
6. כפתור "משיכה" בכרטיס wallet קורא ל-`openWithdrawRequestModal()` ולא ל-`showAdminRequired()`
7. ייבוא מודולים: `require('pg')`, `require('jsonwebtoken')`, `require('bcryptjs')`, `require('multer')`
