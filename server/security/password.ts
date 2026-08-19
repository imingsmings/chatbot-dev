import argon2 from 'argon2'

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1
} as const

async function hashPassword(password: string): Promise<string> {
  if (!password || password.length > 1024) {
    throw new Error('密码长度必须为 1 到 1024 个字符')
  }
  return argon2.hash(password, ARGON2_OPTIONS)
}

async function verifyPassword(hash: string, password: string): Promise<boolean> {
  if (!password || password.length > 1024) return false
  return argon2.verify(hash, password)
}

export { ARGON2_OPTIONS, hashPassword, verifyPassword }
