import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import type { AuthConfig } from '../config/authConfig.ts'

type CreateAuthSessionInput = {
  expiresAt: number
  familyId: string
  issuedAt: number
  jti: string
  sid: string
  subject: string
}

type RotateRefreshInput = {
  currentJti: string
  familyId: string
  issuedAt: number
  newJti: string
  sid: string
}

type RotationResult =
  | { status: 'rotated'; sessionExpiresAt: number }
  | { status: 'invalid' | 'replayed' | 'revoked' }

const databases = new Map<string, Database>()

function digestJti(jti: string): string {
  return createHash('sha256').update(jti).digest('hex')
}

function getDatabase(config: AuthConfig): Database {
  const existing = databases.get(config.databasePath)
  if (existing) return existing

  mkdirSync(path.dirname(config.databasePath), { recursive: true })
  const database = new Database(config.databasePath)
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS auth_sessions (
      sid TEXT PRIMARY KEY,
      family_id TEXT NOT NULL UNIQUE,
      subject TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked_at INTEGER,
      revoked_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      jti_hash TEXT PRIMARY KEY,
      sid TEXT NOT NULL REFERENCES auth_sessions(sid) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('active', 'rotated', 'revoked')),
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      rotated_to_hash TEXT
    );
    CREATE INDEX IF NOT EXISTS auth_refresh_tokens_sid_idx
      ON auth_refresh_tokens(sid);
    CREATE TABLE IF NOT EXISTS auth_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
  databases.set(config.databasePath, database)
  return database
}

function withTransaction<T>(database: Database, callback: () => T): T {
  database.exec('BEGIN IMMEDIATE')
  try {
    const result = callback()
    database.exec('COMMIT')
    return result
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  }
}

function cleanupExpired(database: Database, now: number): void {
  database.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now)
}

function createAuthSession(config: AuthConfig, input: CreateAuthSessionInput): void {
  const database = getDatabase(config)
  withTransaction(database, () => {
    cleanupExpired(database, input.issuedAt)
    database.prepare(`
      INSERT INTO auth_sessions (
        sid, family_id, subject, created_at, expires_at, revoked_at, revoked_reason
      ) VALUES (?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      input.sid,
      input.familyId,
      input.subject,
      input.issuedAt,
      input.expiresAt
    )
    database.prepare(`
      INSERT INTO auth_refresh_tokens (
        jti_hash, sid, status, issued_at, expires_at, used_at, rotated_to_hash
      ) VALUES (?, ?, 'active', ?, ?, NULL, NULL)
    `).run(
      digestJti(input.jti),
      input.sid,
      input.issuedAt,
      input.expiresAt
    )
  })
}

function revokeSessionInTransaction(
  database: Database,
  sid: string,
  now: number,
  reason: string
): void {
  database.prepare(`
    UPDATE auth_sessions
    SET revoked_at = COALESCE(revoked_at, ?),
        revoked_reason = COALESCE(revoked_reason, ?)
    WHERE sid = ?
  `).run(now, reason, sid)
  database.prepare(`
    UPDATE auth_refresh_tokens
    SET status = 'revoked'
    WHERE sid = ? AND status = 'active'
  `).run(sid)
}

function rotateRefreshToken(
  config: AuthConfig,
  input: RotateRefreshInput
): RotationResult {
  const database = getDatabase(config)
  return withTransaction(database, () => {
    cleanupExpired(database, input.issuedAt)
    const session = database.prepare(`
      SELECT sid, family_id, expires_at, revoked_at
      FROM auth_sessions
      WHERE sid = ? AND family_id = ?
    `).get(input.sid, input.familyId) as {
      expires_at: number
      family_id: string
      revoked_at: number | null
      sid: string
    } | undefined

    if (!session) return { status: 'invalid' }
    if (session.revoked_at !== null || session.expires_at <= input.issuedAt) {
      return { status: 'revoked' }
    }

    const currentHash = digestJti(input.currentJti)
    const token = database.prepare(`
      SELECT status, expires_at
      FROM auth_refresh_tokens
      WHERE jti_hash = ? AND sid = ?
    `).get(currentHash, input.sid) as {
      expires_at: number
      status: 'active' | 'rotated' | 'revoked'
    } | undefined

    if (!token || token.status !== 'active') {
      revokeSessionInTransaction(database, input.sid, input.issuedAt, 'refresh_replay')
      return { status: 'replayed' }
    }
    if (token.expires_at <= input.issuedAt) {
      revokeSessionInTransaction(database, input.sid, input.issuedAt, 'refresh_expired')
      return { status: 'revoked' }
    }

    const newHash = digestJti(input.newJti)
    const update = database.prepare(`
      UPDATE auth_refresh_tokens
      SET status = 'rotated', used_at = ?, rotated_to_hash = ?
      WHERE jti_hash = ? AND status = 'active'
    `).run(input.issuedAt, newHash, currentHash)
    if (update.changes !== 1) {
      revokeSessionInTransaction(database, input.sid, input.issuedAt, 'refresh_replay')
      return { status: 'replayed' }
    }
    database.prepare(`
      INSERT INTO auth_refresh_tokens (
        jti_hash, sid, status, issued_at, expires_at, used_at, rotated_to_hash
      ) VALUES (?, ?, 'active', ?, ?, NULL, NULL)
    `).run(newHash, input.sid, input.issuedAt, session.expires_at)

    return { status: 'rotated', sessionExpiresAt: session.expires_at }
  })
}

function isAuthSessionActive(
  config: AuthConfig,
  sid: string,
  subject: string,
  now = Math.floor(Date.now() / 1000)
): boolean {
  const row = getDatabase(config).prepare(`
    SELECT 1 AS active
    FROM auth_sessions
    WHERE sid = ? AND subject = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(sid, subject, now) as { active: number } | undefined
  return row?.active === 1
}

function revokeAuthSession(
  config: AuthConfig,
  sid: string,
  reason: string,
  now = Math.floor(Date.now() / 1000)
): void {
  const database = getDatabase(config)
  withTransaction(database, () => revokeSessionInTransaction(database, sid, now, reason))
}

function revokeAllAuthSessions(
  config: AuthConfig,
  reason = 'revoke_all',
  now = Math.floor(Date.now() / 1000)
): number {
  const database = getDatabase(config)
  return withTransaction(database, () => {
    const result = database.prepare(`
      UPDATE auth_sessions
      SET revoked_at = ?, revoked_reason = ?
      WHERE revoked_at IS NULL AND expires_at > ?
    `).run(now, reason, now)
    database.prepare(`
      UPDATE auth_refresh_tokens
      SET status = 'revoked'
      WHERE status = 'active'
    `).run()
    return Number(result.changes)
  })
}

function checkAuthSessionStoreHealth(config: AuthConfig): void {
  if (!config.enabled) return
  const database = getDatabase(config)
  const key = `health_${process.pid}_${randomUUID()}`
  withTransaction(database, () => {
    database.prepare('INSERT INTO auth_meta (key, value) VALUES (?, ?)').run(key, key)
    const row = database.prepare('SELECT value FROM auth_meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    if (row?.value !== key) throw new Error('认证 Session Store 健康检查失败')
    database.prepare('DELETE FROM auth_meta WHERE key = ?').run(key)
  })
}

function closeAuthSessionStores(): void {
  for (const database of databases.values()) database.close(true)
  databases.clear()
}

export {
  checkAuthSessionStoreHealth,
  closeAuthSessionStores,
  createAuthSession,
  digestJti,
  isAuthSessionActive,
  revokeAllAuthSessions,
  revokeAuthSession,
  rotateRefreshToken
}
export type { CreateAuthSessionInput, RotateRefreshInput, RotationResult }
