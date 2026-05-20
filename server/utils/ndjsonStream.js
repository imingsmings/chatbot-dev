function setNdjsonStreamHeaders(res) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
}

function writeStreamEvent(res, event) {
  if (res.destroyed || res.writableEnded) {
    return false
  }

  res.write(`${JSON.stringify(event)}\n`)
  return true
}

function writeStreamError(res, err) {
  const message = err instanceof Error ? err.message : '模型响应失败'
  writeStreamEvent(res, {
    type: 'error',
    message
  })
}

export {
  setNdjsonStreamHeaders,
  writeStreamError,
  writeStreamEvent
}
