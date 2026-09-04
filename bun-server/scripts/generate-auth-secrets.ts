import { randomBytes } from 'node:crypto'

console.log(`AUTH_ACCESS_TOKEN_SECRET=${randomBytes(32).toString('base64url')}`)
console.log(`AUTH_REFRESH_TOKEN_SECRET=${randomBytes(32).toString('base64url')}`)
