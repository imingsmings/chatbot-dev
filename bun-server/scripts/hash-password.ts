import { stdin, stdout } from 'node:process'
import { hashPassword } from '../security/password.ts'

async function readPassword(): Promise<string> {
  if (!stdin.isTTY) {
    const chunks: Buffer[] = []
    for await (const chunk of stdin) chunks.push(Buffer.from(chunk))
    return Buffer.concat(chunks).toString('utf8').replace(/[\r\n]+$/, '')
  }

  stdout.write('Password: ')
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  return new Promise((resolve, reject) => {
    let value = ''
    const cleanup = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.removeListener('data', handleData)
      stdout.write('\n')
    }
    const handleData = (chunk: string) => {
      for (const character of chunk) {
        if (character === '\u0003') {
          cleanup()
          reject(new Error('Cancelled'))
          return
        }
        if (character === '\r' || character === '\n') {
          cleanup()
          resolve(value)
          return
        }
        if (character === '\u007f') {
          value = value.slice(0, -1)
        } else {
          value += character
        }
      }
    }
    stdin.on('data', handleData)
  })
}

const password = await readPassword()
console.log(await hashPassword(password))
