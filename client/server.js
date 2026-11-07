
// This file runs on YOUR computer. It does 3 things:
//   1. Serves the chat page to your browser
//   2. Connects to the remote server (with the password you type in the page)
//   3. Saves every message in SQLite

// dotenv must be loaded first, because database.js reads DB_FILE from .env
require('dotenv').config({ quiet: true })

const express = require('express')
const http = require('http')
const path = require('path')
const { Server } = require('socket.io')
const { io } = require('socket.io-client')
const { saveMessage, getMessages, getSetting, saveSetting } = require('./database')

// Configuration
const PORT = Number(process.env.PORT) || 3002
const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000'

// The page can only be opened from this computer
const HOST = '127.0.0.1'
const ALLOWED_ORIGINS = [
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`
]

// Limits (the same as the remote server)
const MAX_NAME_LENGTH = 32
const MAX_MESSAGE_LENGTH = 2000
const HISTORY_LIMIT = 200

// The password is sent in plain text, so the server must use https:// or wss://
// if it is not on this computer.
const serverHost = new URL(SERVER_URL).hostname
const isLocalServer = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(serverHost)
const isEncrypted = SERVER_URL.startsWith('https://') || SERVER_URL.startsWith('wss://')

if (!isLocalServer && !isEncrypted) {
    console.warn('WARNING: SERVER_URL is not encrypted. Your password can be seen on the network.')
    console.warn('Use https:// (or wss://) for SERVER_URL.')
}

// State
// serverSocket is the connection to the remote server. null means "logged out".
let serverSocket = null
let isLoggingIn = false
let onlineCount = 0
let savedName = getSetting('name') ?? ''

// Express
const app = express()

app.disable('x-powered-by')

// Security headers for the page
app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', [
        "default-src 'self'",
        `connect-src 'self' ws://localhost:${PORT} ws://127.0.0.1:${PORT}`,
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'"
    ].join('; '))
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    next()
})

app.use(express.static(path.join(__dirname, 'templates')))

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'templates', 'index.html'))
})

// Local Socket.IO (between the browser and this file)
const httpServer = http.createServer(app)

const localIo = new Server(httpServer, {
    transports: ['websocket'],
    maxHttpBufferSize: 20000,
    // Websockets ignore CORS, so we check the Origin ourselves.
    // Without this, any website you open could talk to your local chat.
    allowRequest: (req, callback) => {
        callback(null, ALLOWED_ORIGINS.includes(req.headers.origin))
    }
})

// Helpers

// Same rule as the server: it must be text with a valid length
function cleanText(value, maxLength) {
    if (typeof value !== 'string') {
        return null
    }

    const text = value.trim()

    if (text.length === 0 || text.length > maxLength) {
        return null
    }

    return text
}

// Everything the browser needs to draw the page
function getState() {
    const loggedIn = serverSocket !== null

    return {
        loggedIn: loggedIn,
        connected: loggedIn && serverSocket.connected,
        name: savedName,
        online: onlineCount,
        // The history is only given after login
        messages: loggedIn ? getMessages(HISTORY_LIMIT) : []
    }
}

// Saves the message in SQLite, then shows it in every open page
function storeAndShow(sender, text, isMine, createdAt) {
    try {
        const message = saveMessage(sender, text, isMine, createdAt)
        localIo.emit('message', message)
    } catch (error) {
        console.error('Could not save the message:', error.message)
    }
}

// Remote server connection

// Everything the remote server tells us. We add this BEFORE connecting
// so we can not miss the first events.
function listenToServer(socket) {
    socket.on('connect', () => {
        localIo.emit('status', true)
    })

    socket.on('disconnect', () => {
        localIo.emit('status', false)
    })

    socket.on('online', (count) => {
        onlineCount = count
        localIo.emit('online', count)
    })

    socket.on('message', (data) => {
        // Never trust the data blindly, check it before saving
        const sender = cleanText(data?.name, MAX_NAME_LENGTH)
        const text = cleanText(data?.text, MAX_MESSAGE_LENGTH)

        if (!sender || !text || !Number.isFinite(data.time)) {
            return
        }

        storeAndShow(sender, text, false, data.time)
    })

    socket.on('connect_error', (error) => {
        // Before the login finishes, connectToServer() handles the errors
        if (socket !== serverSocket) {
            return
        }

        // active = false means the server said no (for example the password changed).
        // The library will not try again, so we log out.
        if (!socket.active) {
            logout(error.message)
        }
    })
}

// Connects to the remote server and waits for the first result
function connectToServer(name, password) {
    return new Promise((resolve, reject) => {
        const socket = io(SERVER_URL, {
            auth: { name: name, password: password },
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 3000,
            reconnectionDelayMax: 10000,
            timeout: 10000
        })

        listenToServer(socket)

        socket.once('connect', () => resolve(socket))

        // The very first try failed: stop here, do not retry
        socket.once('connect_error', (error) => {
            socket.close()
            reject(error)
        })
    })
}

function logout(reason) {
    if (serverSocket) {
        serverSocket.close()
        serverSocket = null
    }

    onlineCount = 0
    localIo.emit('logged-out', reason ?? '')
}

// Browser connection
localIo.on('connection', (browser) => {

    // The page asks this when it opens
    browser.on('get-state', (callback) => {
        if (typeof callback !== 'function') {
            return
        }

        callback(getState())
    })

    browser.on('login', async (name, password, callback) => {
        if (typeof callback !== 'function') {
            return
        }

        if (serverSocket || isLoggingIn) {
            return callback({ ok: false, error: 'Already logged in' })
        }

        const cleanName = cleanText(name, MAX_NAME_LENGTH)

        if (!cleanName) {
            return callback({ ok: false, error: `Name must be between 1 and ${MAX_NAME_LENGTH} characters` })
        }

        if (typeof password !== 'string' || !password) {
            return callback({ ok: false, error: 'Password is required' })
        }

        isLoggingIn = true

        try {
            serverSocket = await connectToServer(cleanName, password)

            // Login worked, so we remember the name for next time
            savedName = cleanName
            saveSetting('name', cleanName)

            callback({ ok: true, state: getState() })

        } catch (error) {
            // Errors from our server have "data". Other errors mean no network.
            const message = error.data ? error.message : 'Cannot reach the server'
            callback({ ok: false, error: message })

        } finally {
            isLoggingIn = false
        }
    })

    browser.on('send', (text, callback) => {
        if (typeof callback !== 'function') {
            return
        }

        if (!serverSocket || !serverSocket.connected) {
            return callback({ ok: false, error: 'Not connected to the server' })
        }

        const cleanMessage = cleanText(text, MAX_MESSAGE_LENGTH)

        if (!cleanMessage) {
            return callback({ ok: false, error: `Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters` })
        }

        // We wait 5 seconds for the server to confirm the message
        serverSocket.timeout(5000).emit('message', cleanMessage, (error, response) => {
            if (error || !response?.ok) {
                return callback({ ok: false, error: response?.error ?? 'The server did not answer' })
            }

            // We save the message that the server confirmed (it has the real name and time)
            storeAndShow(response.message.name, response.message.text, true, response.message.time)
            callback({ ok: true })
        })
    })

    browser.on('logout', () => {
        logout()
    })
})

// Local HTTP Server
httpServer.listen(PORT, HOST, () => {
    console.log(`Client running on http://localhost:${PORT}`)
})
