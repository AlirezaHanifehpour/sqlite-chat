
const { Server } = require('socket.io')
const argon2 = require('argon2')
require('dotenv').config({ quiet: true })

// Configuration
const PORT = Number(process.env.PORT) || 3000
const HASHED_PASSWORD = process.env.SOCKET_SERVER_PASSWORD_HASH
// Set TRUST_PROXY=true only if the server is behind nginx / Caddy / Cloudflare.
// Then we read the real IP of the user from the X-Forwarded-For header.
const TRUST_PROXY = process.env.TRUST_PROXY === 'true'

// Limits
const MAX_NAME_LENGTH = 32
const MAX_MESSAGE_LENGTH = 2000
const MAX_PASSWORD_LENGTH = 1024

// Brute force protection: after 5 login attempts from one IP,
// that IP must wait until the 5 minute window is finished.
const MAX_LOGIN_ATTEMPTS = 5
const LOGIN_WINDOW = 5 * 60 * 1000

// Flood protection: one user can send 10 messages every 10 seconds.
const MAX_MESSAGES_PER_WINDOW = 10
const MESSAGE_WINDOW = 10 * 1000

if (!HASHED_PASSWORD) {
    throw new Error('SOCKET_SERVER_PASSWORD_HASH is not configured. Run: npm run hash-password')
}

if (!HASHED_PASSWORD.startsWith('$argon2')) {
    throw new Error('SOCKET_SERVER_PASSWORD_HASH is not a valid argon2 hash. Run: npm run hash-password')
}

// Only the Node.js clients connect here (not browsers), so we do not need CORS.
const io = new Server(PORT, {
    serveClient: false,
    transports: ['websocket'],
    maxHttpBufferSize: 20000,
    connectTimeout: 10000
})

// Helpers

// Name and message must be text, we remove extra spaces and check the length.
// It returns the clean text, or null if the text is not valid.
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

// The error we send back to the client when the connection is rejected.
// "data" is how the client knows this error came from our server.
function rejectConnection(next, message) {
    const error = new Error(message)
    error.data = { rejected: true }
    next(error)
}

function getClientIp(socket) {
    if (TRUST_PROXY) {
        const forwarded = socket.handshake.headers['x-forwarded-for']

        if (typeof forwarded === 'string' && forwarded) {
            return forwarded.split(',')[0].trim()
        }
    }

    return socket.handshake.address
}

// Login attempts
// Map of ip -> { count, resetAt }
const loginAttempts = new Map()

function isBlocked(ip) {
    const entry = loginAttempts.get(ip)

    if (!entry) {
        return false
    }

    if (Date.now() > entry.resetAt) {
        loginAttempts.delete(ip)
        return false
    }

    return entry.count >= MAX_LOGIN_ATTEMPTS
}

// We count the attempt BEFORE checking the password,
// so many parallel attempts can not skip the limit.
function recordAttempt(ip) {
    const entry = loginAttempts.get(ip)

    if (!entry || Date.now() > entry.resetAt) {
        loginAttempts.set(ip, { count: 1, resetAt: Date.now() + LOGIN_WINDOW })
        return
    }

    entry.count++
}

// Remove old entries every 10 minutes so the Map does not grow forever
setInterval(() => {
    const now = Date.now()

    for (const [ip, entry] of loginAttempts) {
        if (now > entry.resetAt) {
            loginAttempts.delete(ip)
        }
    }
}, 10 * 60 * 1000).unref()

// Message flood
function isFlooding(socket) {
    const now = Date.now()

    // Keep only the messages that were sent inside the last window
    socket.data.sentTimes = socket.data.sentTimes.filter((time) => now - time < MESSAGE_WINDOW)

    if (socket.data.sentTimes.length >= MAX_MESSAGES_PER_WINDOW) {
        return true
    }

    socket.data.sentTimes.push(now)
    return false
}

// Tell everyone how many users are online
function sendOnlineCount() {
    io.emit('online', io.sockets.sockets.size)
}

// Authentication middleware
io.use(async (socket, next) => {
    const password = socket.handshake.auth?.password
    const name = cleanText(socket.handshake.auth?.name, MAX_NAME_LENGTH)
    const ip = getClientIp(socket)

    if (isBlocked(ip)) {
        return rejectConnection(next, 'Too many attempts. Try again in a few minutes')
    }

    if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH) {
        return rejectConnection(next, 'Invalid credentials')
    }

    if (!name) {
        return rejectConnection(next, `Name must be between 1 and ${MAX_NAME_LENGTH} characters`)
    }

    recordAttempt(ip)

    try {
        const isValid = await argon2.verify(
            HASHED_PASSWORD,
            password
        )

        if (!isValid) {
            return rejectConnection(next, 'Wrong password')
        }

        // Correct password: forget the failed attempts of this IP
        loginAttempts.delete(ip)

        // The server decides the name of the sender, clients can not change it later
        socket.data.name = name
        socket.data.sentTimes = []

        next()

    } catch (error) {
        console.error('Authentication error:', error.message)
        rejectConnection(next, 'Authentication failed')
    }
})

// Connection
io.on('connection', (socket) => {
    console.log(`${socket.data.name} connected`)
    sendOnlineCount()

    socket.on('message', (text, callback) => {
        if (typeof callback !== 'function') {
            return
        }

        if (isFlooding(socket)) {
            return callback({ ok: false, error: 'You are sending messages too fast' })
        }

        const cleanMessage = cleanText(text, MAX_MESSAGE_LENGTH)

        if (!cleanMessage) {
            return callback({ ok: false, error: `Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters` })
        }

        // The server sets the name and the time, so nobody can fake them
        const message = {
            name: socket.data.name,
            text: cleanMessage,
            time: Date.now()
        }

        // Everyone gets it except the sender
        socket.broadcast.emit('message', message)

        // The sender gets the final message in the callback
        callback({ ok: true, message: message })
    })

    socket.on('disconnect', (reason) => {
        console.log(`${socket.data.name} disconnected: ${reason}`)
        sendOnlineCount()
    })
})

console.log(`Socket server running on port ${PORT}`)
