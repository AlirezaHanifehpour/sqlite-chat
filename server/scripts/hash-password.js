// Run with: npm run hash-password
// It asks for a password and prints the line you need to paste into server/.env
// The password is never saved anywhere, only its hash is printed.

const argon2 = require('argon2')
const readline = require('readline')
const { Writable } = require('stream')

// Everything we print goes through this stream.
// While "muted" is true the typed characters are hidden (like a password field).
let muted = false

const output = new Writable({
    write(chunk, encoding, callback) {
        if (!muted) {
            process.stdout.write(chunk, encoding)
        }
        callback()
    }
})

const rl = readline.createInterface({
    input: process.stdin,
    output: output,
    terminal: true
})

function ask(question, hidden) {
    return new Promise((resolve) => {
        muted = false
        rl.question(question, (answer) => {
            muted = false
            resolve(answer)
        })
        muted = hidden
    })
}

async function main() {
    const password = await ask('Choose a server password: ', true)
    console.log()

    if (password.length < 8) {
        console.error('Password is too short. Use at least 8 characters.')
        process.exit(1)
    }

    const confirm = await ask('Type it again: ', true)
    console.log()

    if (password !== confirm) {
        console.error('The two passwords are not the same.')
        process.exit(1)
    }

    const hash = await argon2.hash(password)

    console.log('Done! Paste this line into server/.env :\n')
    console.log(`SOCKET_SERVER_PASSWORD_HASH='${hash}'`)
    console.log()

    rl.close()
}

main()
