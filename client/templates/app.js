// The socket.io file is served by our own local server (no CDN needed)
import { io } from "/socket.io/socket.io.esm.min.js"

const messageForm = document.querySelector('#messageForm')
const messageInput = document.querySelector('#message')
const messageList = document.querySelector('#messageList')
const chatContent = document.querySelector('#chatContent')
const notice = document.querySelector('#notice')
const statusDot = document.querySelector('#statusDot')
const statusText = document.querySelector('#statusText')
const logoutBtn = document.querySelector('#logoutBtn')

const loginModal = document.querySelector('#loginModal')
const loginForm = document.querySelector('#loginForm')
const nameInput = document.querySelector('#nameInput')
const passwordInput = document.querySelector('#passwordInput')
const loginError = document.querySelector('#loginError')
const loginBtn = document.querySelector('#loginBtn')

// The last day that we have drawn, so we know when to add a new date divider
let lastDay = ''
let onlineCount = 0
let noticeTimer = null

// Socket.IO connection to OUR local server (not to the remote server)
const socket = io({
    transports: ['websocket']
})

// Login screen

function showLogin(errorText) {
    loginModal.classList.remove('hidden')
    messageList.innerHTML = ''
    lastDay = ''

    if (errorText) {
        showLoginError(errorText)
    }

    // If the name is already filled, we jump to the password
    if (nameInput.value) {
        passwordInput.focus()
    } else {
        nameInput.focus()
    }
}

function showLoginError(text) {
    loginError.textContent = text
    loginError.classList.remove('hidden')
}

function hideLogin() {
    loginModal.classList.add('hidden')
    loginError.classList.add('hidden')
    messageInput.focus()
}

loginForm.addEventListener('submit', (event) => {
    event.preventDefault()

    const name = nameInput.value.trim()
    const password = passwordInput.value

    if (name === "" || password === "") {
        showLoginError('Please fill in your name and the password')
        return
    }

    loginBtn.disabled = true
    loginBtn.textContent = 'Joining...'

    socket.emit('login', name, password, (response) => {
        loginBtn.disabled = false
        loginBtn.textContent = 'Join'

        // We never keep the password in the page
        passwordInput.value = ""

        if (!response.ok) {
            showLoginError(response.error)
            return
        }

        applyState(response.state)
    })
})

logoutBtn.addEventListener('click', () => {
    socket.emit('logout')
})

// Drawing the page

function applyState(state) {
    nameInput.value = state.name

    if (!state.loggedIn) {
        showLogin()
        return
    }

    hideLogin()

    messageList.innerHTML = ''
    lastDay = ''
    state.messages.forEach(addMessage)

    setOnline(state.online)
    setConnected(state.connected)
}

function setConnected(connected) {
    statusDot.classList.toggle('online', connected)
    messageInput.disabled = !connected

    if (connected) {
        statusText.textContent = onlineCount + ' online'
        messageInput.placeholder = "Write a message..."
    } else {
        statusText.textContent = 'Reconnecting...'
        messageInput.placeholder = "Waiting for the server..."
    }
}

function setOnline(count) {
    onlineCount = count

    if (!messageInput.disabled) {
        statusText.textContent = count + ' online'
    }
}

function showNotice(text) {
    notice.textContent = text
    notice.classList.remove('hidden')

    clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => {
        notice.classList.add('hidden')
    }, 4000)
}

// "Today", "Yesterday" or the date
function formatDay(date) {
    const today = new Date()
    const yesterday = new Date()
    yesterday.setDate(today.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
        return 'Today'
    }

    if (date.toDateString() === yesterday.toDateString()) {
        return 'Yesterday'
    }

    return date.toLocaleDateString()
}

function addDateDivider(date) {
    const divider = document.createElement('li')
    divider.className = 'date-divider'

    const label = document.createElement('span')
    label.textContent = formatDay(date)

    divider.append(label)
    messageList.append(divider)
}

// We build the message with textContent (not innerHTML),
// so a message like "<script>" is shown as text and can never run.
function addMessage(message) {
    const date = new Date(message.createdAt)

    if (date.toDateString() !== lastDay) {
        addDateDivider(date)
        lastDay = date.toDateString()
    }

    const item = document.createElement('li')
    item.className = message.isMine ? 'message sent' : 'message received'

    const username = document.createElement('span')
    username.className = 'username'
    username.textContent = message.isMine ? 'You' : message.sender

    const bubble = document.createElement('div')
    bubble.className = 'message-bubble'

    // dir="auto" makes Persian / Arabic text go right to left
    const text = document.createElement('p')
    text.dir = 'auto'
    text.textContent = message.text

    const time = document.createElement('time')
    time.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    bubble.append(text, time)
    item.append(username, bubble)
    messageList.append(item)

    chatContent.scrollTop = chatContent.scrollHeight
}

// Sending

messageForm.addEventListener('submit', (event) => {
    event.preventDefault()

    const text = messageInput.value.trim()

    if (text === "") {
        return
    }

    socket.emit('send', text, (response) => {
        if (!response.ok) {
            showNotice(response.error)
            return
        }

        messageInput.value = ""
    })
})

// Events from the local server

socket.on('connect', () => {
    // Ask what is going on (are we logged in? what is the history?)
    socket.emit('get-state', applyState)
})

socket.on('message', addMessage)

socket.on('status', setConnected)

socket.on('online', setOnline)

socket.on('logged-out', (reason) => {
    passwordInput.value = ""
    showLogin(reason)
})
