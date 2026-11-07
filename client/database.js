// All SQLite work is here. The rest of the client never writes SQL.
// The database file lives on YOUR computer, the server never sees it.

const path = require('path')
const fs = require('fs')

// SQLite is built into Node.js, so we do not need any package for it.
// It needs Node.js 22.13 or newer.
let DatabaseSync

try {
    DatabaseSync = require('node:sqlite').DatabaseSync
} catch (error) {
    throw new Error(`This app needs Node.js 22.13 or newer (you have ${process.version})`)
}

// Where the database file is saved. You can change it with DB_FILE in client/.env
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'chat.db')

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true })

const db = new DatabaseSync(DB_FILE)

// WAL is faster and safer if the app is closed in the middle of a write
db.exec('PRAGMA journal_mode = WAL')

// Migrations
// To change the database later, ADD a new item at the end of this list.
// Never edit the old items, because they have already run on old databases.
// SQLite remembers how many items were run in "user_version".
const migrations = [
    // 1: first version
    `
    CREATE TABLE messages (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        sender     TEXT    NOT NULL,
        text       TEXT    NOT NULL,
        is_mine    INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    );

    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    `
]

function runMigrations() {
    const currentVersion = db.prepare('PRAGMA user_version').get().user_version

    for (let version = currentVersion; version < migrations.length; version++) {
        db.exec(migrations[version])
        db.exec(`PRAGMA user_version = ${version + 1}`)
    }
}

runMigrations()

// Prepared statements (the "?" are filled safely, so SQL injection is not possible)
const insertMessage = db.prepare(`
    INSERT INTO messages (sender, text, is_mine, created_at)
    VALUES (?, ?, ?, ?)
`)

const selectLastMessages = db.prepare(`
    SELECT id, sender, text, is_mine, created_at
    FROM messages
    ORDER BY id DESC
    LIMIT ?
`)

const selectSetting = db.prepare('SELECT value FROM settings WHERE key = ?')

const upsertSetting = db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
`)

// Turns a database row into the object we send to the browser
function toMessage(row) {
    return {
        id: row.id,
        sender: row.sender,
        text: row.text,
        isMine: row.is_mine === 1,
        createdAt: row.created_at
    }
}

// Messages
function saveMessage(sender, text, isMine, createdAt) {
    const result = insertMessage.run(sender, text, isMine ? 1 : 0, createdAt)

    return {
        id: Number(result.lastInsertRowid),
        sender: sender,
        text: text,
        isMine: isMine,
        createdAt: createdAt
    }
}

// Returns the last messages, the oldest one first
function getMessages(limit) {
    return selectLastMessages.all(limit).map(toMessage).reverse()
}

// Settings (we keep your name here)
function getSetting(key) {
    const row = selectSetting.get(key)
    return row ? row.value : null
}

function saveSetting(key, value) {
    upsertSetting.run(key, value)
}

module.exports = { saveMessage, getMessages, getSetting, saveSetting }
