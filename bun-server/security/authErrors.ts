class AuthError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status = 401, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuthError'
    this.code = code
    this.status = status
  }
}

export { AuthError }
