import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { delay } from './services.mjs'
import { evaluate } from './cdpClient.mjs'

async function waitForEval(client, expression, timeoutMs = 15000) {
  const start = Date.now()

  while (Date.now() - start < timeoutMs) {
    if (await evaluate(client, expression)) return
    await delay(100)
  }

  throw new Error(`Timed out waiting for expression: ${expression}`)
}

async function screenshot(client, outDir, name, enabled = false) {
  if (!enabled) return null
  const result = await client.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
  })
  const filePath = path.join(outDir, `${name}.png`)
  await writeFile(filePath, Buffer.from(result.data, 'base64'))
  console.log(filePath)
  return filePath
}

async function ask(client, question) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('textarea');
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      valueSetter.call(input, ${JSON.stringify(question)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    })()`,
  )
}

export {
  ask,
  screenshot,
  waitForEval,
}
