# SQLite Chat

A small private chat. Everyone runs the **client** on their own computer, types the **server password**, and chats with the others in real time.

Every message and every name is saved in a **SQLite file on your own computer**. The server only passes messages along. It stores nothing.

**Version 1.0.0** · Made by [Alireza Hanifehpour](https://github.com/AlirezaHanifehpour)

---

## How it works

```
 Your browser          Your computer (client/)                Host (server/)
┌────────────┐       ┌─────────────────────────┐          ┌──────────────────┐
│  Chat page │ <───> │  Node.js + SQLite       │ <──────> │  Node.js         │
│            │ local │  saves every message    │ WebSocket│  checks password │
└────────────┘       └─────────────────────────┘          │  passes messages │
                                                           └──────────────────┘
                                                                  ▲
                      Other people run the same client ───────────┘
```

1. You open `http://localhost:3002` and type your name and the server password.
2. The client (running on your computer) connects to the server with that password.
3. When someone sends a message, the server passes it to everyone, and each client saves it in its own SQLite database.

The password is typed in the page and sent to your local client. It is **never written to disk** and never put in the page's code.

## Features

- Password protected (argon2 hash on the server)
- Messages and names saved in SQLite on each user's computer
- Your name is remembered for the next time
- Chat history is loaded again after you restart the app
- Live online counter and connection status, automatic reconnect
- Persian / Arabic text is shown right to left
- Brute-force and message-flood protection

## Project structure

```
sqlite-chat/
├── server/                     # Runs on the host
│   ├── server.js               # Password check + passing messages
│   ├── scripts/
│   │   └── hash-password.js    # Creates the password hash
│   └── .env.example
│
└── client/                     # Runs on each user's computer
    ├── server.js               # Local server: page + remote connection + saving
    ├── database.js             # All SQLite code (tables, save, read)
    ├── templates/
    │   ├── index.html          # The chat page
    │   ├── style.css
    │   └── app.js              # Browser code
    ├── data/                   # chat.db is created here (ignored by git)
    └── .env.example
```

## Requirements

- [Node.js](https://nodejs.org) **22.13 or newer** for the client (it uses the SQLite that is built into Node.js, so there is no database package to install or build)
- Node.js 20 or newer is enough for the server

> On Node.js 22 you will see a line `ExperimentalWarning: SQLite is an experimental feature`. This is normal and safe to ignore.

## Quick start

### 0. Get the code

```bash
git clone https://github.com/AlirezaHanifehpour/sqlite-chat.git
cd sqlite-chat
```

### 1. Start the server (on the host)

```bash
cd server
npm install
npm run hash-password
```

Type a password (at least 8 characters). The script prints a line like this:

```
SOCKET_SERVER_PASSWORD_HASH='$argon2id$v=19$m=65536,...'
```

Copy `.env.example` to `.env` and paste that line into it:

```bash
cp .env.example .env
```

Then start it:

```bash
npm start
```

### 2. Start the client (on each user's computer)

```bash
cd client
npm install
cp .env.example .env
```

Open `client/.env` and set `SERVER_URL` to the address of the server, then:

```bash
npm start
```

Open **http://localhost:3002**, type your name and the password, and start chatting.

> **Want to test alone?** Start a second client on another port with its own database:
>
> ```bash
> PORT=3003 DB_FILE=./data/second.db npm start
> ```
>
> Then open http://localhost:3003 in another browser window. (On Windows PowerShell: `$env:PORT=3003; $env:DB_FILE="./data/second.db"; npm start`)

## Configuration

**`server/.env`**

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | Port of the server |
| `SOCKET_SERVER_PASSWORD_HASH` | (required) | argon2 hash made by `npm run hash-password` |
| `TRUST_PROXY` | `false` | Set to `true` only behind nginx / Caddy / Cloudflare (see [Deploying](#deploying-on-the-internet)) |

**`client/.env`**

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3002` | Port of the chat page on your computer |
| `SERVER_URL` | `http://localhost:3000` | Address of the server |
| `DB_FILE` | `./data/chat.db` | Where your messages are saved |

## Your data

Everything is in one file: `client/data/chat.db` (plus `chat.db-wal` and `chat.db-shm` while the app is running).

- **Backup:** close the app and copy `chat.db`.
- **Delete your history:** close the app and delete the `data/` folder.
- **Look inside:** `sqlite3 client/data/chat.db "SELECT * FROM messages;"`

| Table | Columns | What is inside |
| --- | --- | --- |
| `messages` | `id`, `sender`, `text`, `is_mine`, `created_at` | Every message. `created_at` is a Unix time in milliseconds. |
| `settings` | `key`, `value` | Your name (`key = 'name'`) |

## Security

What is already done:

- **Password:** only an argon2 hash is on the server. The password itself is never stored anywhere.
- **Brute force:** one IP can try 5 passwords every 5 minutes. After that it is blocked until the time is over.
- **Flood:** one user can send 10 messages every 10 seconds.
- **Validation:** the server checks the type and the length of every name and message. The server sets the sender name and the time, so nobody can fake them.
- **XSS:** messages are shown with `textContent`, never `innerHTML`, so `<script>` in a message is only text. The page also has a strict Content-Security-Policy.
- **SQL injection:** all queries use prepared statements.
- **Local page:** the client listens only on `127.0.0.1` (other computers can not open it) and refuses WebSocket connections from other websites.
- **Secrets:** `.env` and your database are in `.gitignore`, so they do not go to GitHub by accident.

Things you should know:

- **There is one shared password for everybody.** Anyone who knows it can join and can choose any name, so names are not proof of identity. Share the password only with people you trust.
- **Use HTTPS for a server on the internet.** Without it, the password and messages can be read on the network. The client prints a warning if `SERVER_URL` is not encrypted.
- **The SQLite file is not encrypted.** Anyone who can open your computer can read it.
- **The server does not keep messages.** If you are offline, you do not receive the messages that others send.

## Deploying on the internet

Put the server behind a reverse proxy that gives you HTTPS. With [Caddy](https://caddyserver.com), this is the whole config (WebSockets and certificates work automatically):

```
chat.example.com {
    reverse_proxy localhost:3000
}
```

Then:

1. In `server/.env` set `TRUST_PROXY=true`. The server will use the real IP of each user (needed for the brute-force protection). Do this **only** if the server can not be reached directly, so block port 3000 from the outside with your firewall.
2. In each `client/.env` set `SERVER_URL=https://chat.example.com`.

## How the code talks (for development)

**Browser ⇄ local client** (`client/templates/app.js` ⇄ `client/server.js`)

| Event | Direction | Description |
| --- | --- | --- |
| `get-state` | browser → client | Asks: am I logged in? Gets name, history, online count |
| `login` `(name, password)` | browser → client | Connects to the server. Answers `{ ok, state }` or `{ ok: false, error }` |
| `send` `(text)` | browser → client | Sends a message. Answers `{ ok }` or `{ ok: false, error }` |
| `logout` | browser → client | Disconnects from the server |
| `message` | client → browser | A new message (already saved in SQLite) |
| `status` `(connected)` | client → browser | Connection to the server went up or down |
| `online` `(count)` | client → browser | How many people are online |
| `logged-out` `(reason)` | client → browser | You were logged out, show the login window |

**Local client ⇄ server** (`client/server.js` ⇄ `server/server.js`)

| Event | Direction | Description |
| --- | --- | --- |
| handshake `auth` | client → server | `{ name, password }`, checked in the middleware |
| `message` `(text)` | client → server | Answers `{ ok, message }` with the final name and time |
| `message` `{ name, text, time }` | server → others | A message from another user |
| `online` `(count)` | server → all | The number of connected users |

## Extending the project

- **Add a column or a table:** open `client/database.js` and **add a new item at the end** of the `migrations` list. Do not edit the old items. Old databases are updated automatically the next time the app starts.
- **Add a new feature (for example "user is typing"):** add the event to `server/server.js`, pass it through `listenToServer()` in `client/server.js`, and listen to it in `client/templates/app.js`.
- **Change limits** (message length, flood, login attempts): they are constants at the top of `server/server.js`.

Ideas for the next versions: private messages, rooms, unique names, sending files, encrypting the SQLite file, desktop app (Electron).

## Troubleshooting

| Problem | Solution |
| --- | --- |
| `SOCKET_SERVER_PASSWORD_HASH is not a valid argon2 hash` | Run `npm run hash-password` and paste the whole line, with the single quotes, into `server/.env` |
| `Cannot reach the server` | Check that the server is running and that `SERVER_URL` in `client/.env` is correct |
| `Too many attempts` | Wait 5 minutes, or restart the server |
| `Wrong password` | The password must be the one you typed in `npm run hash-password` |
| `EADDRINUSE` | The port is already used. Change `PORT` in `.env` |
| `This app needs Node.js 22.13 or newer` | Update Node.js (check with `node -v`). With nvm: `nvm install 22 && nvm use 22` |
| `unable to open database file` | The folder of `DB_FILE` can not be written. Check the path in `client/.env` and the folder permissions |
| `database is locked` | Two clients use the same database file. Give each one its own `DB_FILE` |

## Issues and ideas

Found a bug or have an idea? Please open an [issue](https://github.com/AlirezaHanifehpour/sqlite-chat/issues).

## Author

[Alireza Hanifehpour](https://github.com/AlirezaHanifehpour)