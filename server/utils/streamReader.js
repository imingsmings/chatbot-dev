async function readLinesFromStream(stream, onLine) {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  const handleLine = async (line) => {
    const result = await onLine(line)
    return result === false
  }

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const shouldStop = await handleLine(line)
      if (shouldStop) {
        await reader.cancel()
        return
      }
    }
  }

  buffer += decoder.decode()

  if (buffer.trim()) {
    await handleLine(buffer)
  }
}

module.exports = {
  readLinesFromStream
}
