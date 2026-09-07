import { createHash } from 'node:crypto'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { strFromU8, unzipSync } from '../../bun-server/node_modules/fflate/esm/index.mjs'
import { authenticateBrowser, createAuthenticatedFetch } from './helpers/authentication.mjs'
import { screenshot, waitForEval } from './helpers/appActions.mjs'
import { getPageTarget, launchChrome } from './helpers/browser.mjs'
import { CdpClient, evaluate } from './helpers/cdpClient.mjs'
import { delay, stopProcess } from './helpers/services.mjs'

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/'
const API_URL = new URL('/api/', APP_URL)
const DEBUG_PORT = Number(process.env.CDP_REAL_VISION_PORT || 9352)
const WAIT_TIMEOUT_MS = Number(process.env.CDP_REAL_VISION_WAIT_TIMEOUT_MS || 240_000)
const CAPTURE_SCREENSHOTS = process.env.CDP_SCREENSHOTS === '1'
const OUT_DIR = path.resolve(process.cwd(), '.tmp/cdp-real-vision-screenshots')
const IMAGE_PATH = process.env.CDP_REAL_VISION_IMAGE ||
  '/Users/jason/Downloads/ai-basic-master/03. LLM基础知识/24. [MCP]Resources基础知识/课堂代码/demo/src/assets/books.jpeg'
const VISION_MODEL = 'deepseek-v4-flash-vision-exp'
const authenticatedFetch = createAuthenticatedFetch(APP_URL)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function api(pathname, init) {
  const response = await authenticatedFetch(new URL(pathname, API_URL), init)
  if (!response.ok) {
    throw new Error(`API ${pathname} failed (${response.status}): ${await response.text()}`)
  }
  return response
}

async function summaries() {
  return (await (await api('conversations')).json()).conversations
}

async function latestConversation() {
  const list = await summaries()
  const latest = [...list].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0]
  assert(latest, 'no conversation is available')
  return (await (await api(`conversations/${encodeURIComponent(latest.id)}`)).json()).conversation
}

async function waitForNode(check, message, timeoutMs = WAIT_TIMEOUT_MS) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const value = await check()
    if (value) return value
    await delay(150)
  }
  throw new Error(message)
}

async function uploadImage(client) {
  await client.send('DOM.enable')
  const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true })
  const { nodeId } = await client.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '.composer input[accept*="image"]',
  })
  assert(nodeId, 'image input is missing')
  await client.send('DOM.setFileInputFiles', { files: [IMAGE_PATH], nodeId })
  await waitForEval(
    client,
    `document.querySelector('[data-upload-status="ready"]')?.innerText.includes('books.jpeg')`,
    30_000,
  )
}

async function submit(client, question) {
  const before = await evaluate(client, `({
    userRows: document.querySelectorAll('.message-row.user').length,
    assistantRows: document.querySelectorAll('.message-row.assistant').length,
  })`)
  await evaluate(client, `(() => {
    const textarea = document.querySelector('.composer textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, ${JSON.stringify(question)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await waitForEval(
    client,
    `document.querySelector('.composer textarea')?.value === ${JSON.stringify(question)} &&
      document.querySelector('button[aria-label="发送消息"]')?.disabled === false`,
    30_000,
  )
  const clicked = await evaluate(client, `(() => {
    const button = document.querySelector('button[aria-label="发送消息"]');
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`)
  assert(clicked, 'real Vision send button was not clickable')
  await waitForEval(
    client,
    `document.querySelectorAll('.message-row.user').length > ${before.userRows} ||
      Boolean(document.querySelector('button[aria-label="停止生成"]'))`,
    30_000,
  )
  return before
}

async function waitForCompletedAnswer(client, before) {
  await waitForEval(
    client,
    `Boolean(document.querySelector('button[aria-label="停止生成"]')) ||
      document.querySelectorAll('.message-row.assistant').length > ${before.assistantRows}`,
    WAIT_TIMEOUT_MS,
  )
  await waitForEval(
    client,
    `!document.querySelector('button[aria-label="停止生成"]') &&
      document.querySelectorAll('.message-row.assistant').length > ${before.assistantRows} &&
      [...document.querySelectorAll('.message-row.assistant .message-text')]
        .at(-1)?.textContent.trim().length > 0`,
    WAIT_TIMEOUT_MS,
  )
  return evaluate(
    client,
    `[...document.querySelectorAll('.message-row.assistant .message-text')].at(-1)?.textContent.trim() || ''`,
  )
}

async function startNewConversation(client) {
  await evaluate(client, `document.querySelector('button[aria-label="新建会话"]')?.click()`)
  await waitForEval(client, `Boolean(document.querySelector('.empty-state'))`)
}

async function cleanupCreatedConversations(preservedIds) {
  for (const conversation of await summaries().catch(() => [])) {
    if (!preservedIds.has(conversation.id)) {
      await authenticatedFetch(new URL(`conversations/${encodeURIComponent(conversation.id)}`, API_URL), {
        method: 'DELETE',
      }).catch(() => undefined)
    }
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const source = await readFile(IMAGE_PATH)
  const sourceSha256 = createHash('sha256').update(source).digest('hex')
  const preservedIds = new Set((await summaries()).map((conversation) => conversation.id))
  const { chrome } = await launchChrome({
    url: APP_URL,
    debugPort: DEBUG_PORT,
    profilePrefix: 'chatbot-real-vision-cdp-',
    windowSize: '1280,900',
  })
  let client
  const screenshots = []
  const assertions = {
    source: {
      path: IMAGE_PATH,
      bytes: source.length,
      sha256: sourceSha256,
    },
  }

  try {
    const target = await getPageTarget(DEBUG_PORT, APP_URL)
    client = new CdpClient(target.webSocketDebuggerUrl)
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await authenticateBrowser(client)
    await waitForEval(client, `Boolean(document.querySelector('.composer textarea'))`)
    await waitForEval(
      client,
      `document.querySelector('.model-menu-trigger')?.textContent.includes('Vision')`,
    )

    const pureTextBefore = await submit(
      client,
      '这是 Vision 纯文本工具测试，不要分析图片。必须调用 calculate 工具计算 6 * 7，并在最终回答中包含 PURE-VISION=42。',
    )
    const pureTextAnswer = await waitForCompletedAnswer(client, pureTextBefore)
    assert(/PURE-VISION\s*=\s*42/i.test(pureTextAnswer), `real Vision pure-text tool answer is wrong: ${pureTextAnswer}`)
    const pureTextConversation = await latestConversation()
    const pureTextUser = pureTextConversation.messages.at(-2)
    const pureTextAssistant = pureTextConversation.messages.at(-1)
    assert(!pureTextUser?.attachments?.length, 'real Vision pure-text request unexpectedly persisted an attachment')
    assert(pureTextAssistant?.generation?.model === VISION_MODEL, 'real Vision pure-text request used the wrong model')
    assert(
      pureTextAssistant?.toolTrace?.some((item) => item.name === 'calculate' && item.success),
      'real Vision pure-text request did not persist a successful calculator trace',
    )

    await startNewConversation(client)

    await uploadImage(client)
    screenshots.push(await screenshot(client, OUT_DIR, '01-real-downloads-image-ready', CAPTURE_SCREENSHOTS))
    const recognitionBefore = await submit(
      client,
      '请识别图片主体，并严格包含两行：BOOKS=yes 或 BOOKS=no；VESSEL=yes 或 VESSEL=no。BOOKS 表示一摞书，VESSEL 表示书上方的饮用容器。',
    )
    const recognitionText = await waitForCompletedAnswer(client, recognitionBefore)
    assert(/BOOKS\s*=\s*yes/i.test(recognitionText), `real Vision did not recognize books: ${recognitionText}`)
    assert(/VESSEL\s*=\s*yes/i.test(recognitionText), `real Vision did not recognize the vessel: ${recognitionText}`)
    screenshots.push(await screenshot(client, OUT_DIR, '02-real-vision-recognition-completed', CAPTURE_SCREENSHOTS))

    const first = await latestConversation()
    const firstUser = first.messages.at(-2)
    const firstAnswer = first.messages.at(-1)
    assert(firstUser?.attachments?.length === 1, 'real Vision user message did not persist one attachment')
    assert(firstAnswer?.generation?.provider === 'deepseek', 'real Vision generation provider was not persisted')
    assert(firstAnswer?.generation?.model === VISION_MODEL, 'real Vision generation model was not persisted')
    assert(firstAnswer?.status === 'completed', 'real Vision completed answer status was not persisted')
    const attachment = firstUser.attachments[0]
    const downloaded = Buffer.from(await (await api(
      `conversations/${encodeURIComponent(first.id)}/attachments/${encodeURIComponent(attachment.id)}`,
    )).arrayBuffer())
    assert(createHash('sha256').update(downloaded).digest('hex') === sourceSha256, 'stored image bytes changed')

    const previewResponse = await api(`conversations/${encodeURIComponent(first.id)}/context-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: '检查历史图片上下文。',
        attachmentIds: [],
        options: { provider: 'deepseek', model: VISION_MODEL },
      }),
    })
    const preview = (await previewResponse.json()).context
    assert(preview.stats.selectedImages === 1, 'real context preview did not select the historical image')
    assert(preview.stats.selectedImageBytes === source.length, 'real context preview image byte count is wrong')
    assert(preview.stats.tokenBreakdown.images > 0, 'real Vision context preview omitted image tokens')
    assert(
      preview.stats.estimatedTotalTokens <= preview.stats.contextWindowTokens,
      'real Vision context preview exceeds the configured model context window',
    )
    assert(
      preview.stats.estimator === 'deepseek-utf8-conservative-v1',
      `real Vision context preview used an unexpected estimator: ${preview.stats.estimator}`,
    )

    await evaluate(client, `document.querySelector('button[aria-label^="预览图片"]')?.click()`)
    await waitForEval(client, `Boolean(document.querySelector('[role="dialog"] img'))`)
    screenshots.push(await screenshot(client, OUT_DIR, '03-real-protected-image-preview', CAPTURE_SCREENSHOTS))
    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' })
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' })

    await client.send('Page.reload')
    await authenticateBrowser(client)
    await waitForEval(client, `Boolean(document.querySelector('img[alt="books.jpeg"]'))`, 30_000)
    await waitForEval(client, `document.body.innerText.includes('BOOKS')`)
    screenshots.push(await screenshot(client, OUT_DIR, '04-real-image-survives-refresh', CAPTURE_SCREENSHOTS))

    const beforeBranchIds = new Set((await summaries()).map((conversation) => conversation.id))
    await evaluate(client, `document.querySelector('button[aria-label="重新生成回答"]')?.click()`)
    const branch = await waitForNode(async () => {
      const list = await summaries()
      const created = list.find((conversation) => !beforeBranchIds.has(conversation.id))
      if (!created) return null
      const detail = (await (await api(`conversations/${encodeURIComponent(created.id)}`)).json()).conversation
      return detail.messages.at(-1)?.status === 'completed' ? detail : null
    }, 'real Vision regeneration branch did not complete')
    await waitForEval(
      client,
      `!document.querySelector('button[aria-label="停止生成"]') &&
        [...document.querySelectorAll('.message-row.assistant .message-text')]
          .at(-1)?.textContent.trim().length > 0`,
      WAIT_TIMEOUT_MS,
    )
    assert(branch.messages.at(-2)?.attachments?.length === 1, 'real Vision branch lost the image')
    assert(branch.messages.at(-2).attachments[0].id !== attachment.id, 'real Vision branch reused the parent attachment id')
    const parentAfterBranch = (await (await api(`conversations/${encodeURIComponent(first.id)}`)).json()).conversation
    assert(parentAfterBranch.messages.length === 2, 'real Vision branch mutated the parent conversation')
    screenshots.push(await screenshot(client, OUT_DIR, '05-real-vision-branch-completed', CAPTURE_SCREENSHOTS))

    await startNewConversation(client)
    await uploadImage(client)
    const imageOnlyBefore = await submit(client, '')
    const imageOnlyText = await waitForCompletedAnswer(client, imageOnlyBefore)
    assert(imageOnlyText.length > 0, 'real image-only message returned an empty answer')
    const imageOnly = await latestConversation()
    assert(imageOnly.messages.at(-2)?.content === '', 'real image-only user message gained text content')
    assert(imageOnly.messages.at(-2)?.attachments?.length === 1, 'real image-only message lost its attachment')
    screenshots.push(await screenshot(client, OUT_DIR, '06-real-image-only-completed', CAPTURE_SCREENSHOTS))

    await startNewConversation(client)
    await uploadImage(client)
    await submit(client, '请结合图片写一篇至少 1200 字的详细观察报告，用于测试停止生成。')
    await waitForEval(client, `Boolean(document.querySelector('button[aria-label="停止生成"]'))`, WAIT_TIMEOUT_MS)
    await waitForEval(
      client,
      `Boolean(document.querySelector('button[aria-label="停止生成"]')) &&
        Math.max(
          [...document.querySelectorAll('.message-row.assistant .message-text')]
            .at(-1)?.textContent.trim().length || 0,
          [...document.querySelectorAll('.reasoning-content-body')]
            .at(-1)?.textContent.trim().length || 0
        ) >= 30`,
      WAIT_TIMEOUT_MS,
    )
    screenshots.push(await screenshot(client, OUT_DIR, '07-real-vision-before-stop', CAPTURE_SCREENSHOTS))
    await evaluate(client, `document.querySelector('button[aria-label="停止生成"]')?.click()`)
    await waitForEval(client, `document.body.innerText.includes('已停止生成')`, 30_000)
    const stopped = await latestConversation()
    assert(stopped.messages.at(-1)?.status === 'stopped', 'real Vision stopped status was not persisted')
    assert(stopped.messages.at(-2)?.attachments?.length === 1, 'real Vision stopped message lost its image')
    screenshots.push(await screenshot(client, OUT_DIR, '08-real-vision-stopped', CAPTURE_SCREENSHOTS))

    const recoveryBefore = await submit(client, '停止后恢复测试：请确认你仍可以继续回答，无需分析历史图片。')
    const recoveryText = await waitForCompletedAnswer(client, recoveryBefore)
    assert(recoveryText.length > 0, 'real Vision recovery returned an empty answer')
    const recovered = await latestConversation()
    assert(recovered.messages.at(-3)?.status === 'stopped', 'real Vision recovery replaced the stopped answer')
    assert(recovered.messages.at(-1)?.status === 'completed', 'real Vision recovery answer was not completed')

    await startNewConversation(client)
    await uploadImage(client)
    const fullRecognitionBefore = await submit(
      client,
      '完整图片识别测试：请从头完整输出这张图片的中文识别报告，不少于 600 个汉字。至少覆盖主体、关键物品、相对位置、颜色、构图和不确定信息，使用完整句子，不要输出测试标记。',
    )
    const fullRecognitionText = await waitForCompletedAnswer(client, fullRecognitionBefore)
    assert(
      fullRecognitionText.length >= 500,
      `real Vision full recognition is too short (${fullRecognitionText.length} chars): ${fullRecognitionText}`,
    )
    assert(/书/.test(fullRecognitionText), `real Vision full recognition omitted the books: ${fullRecognitionText}`)
    assert(
      /(容器|茶壶|茶杯|马黛|葫芦|杯)/.test(fullRecognitionText),
      `real Vision full recognition omitted the vessel: ${fullRecognitionText}`,
    )
    const fullRecognition = await latestConversation()
    assert(fullRecognition.messages.at(-2)?.attachments?.length === 1, 'real Vision full recognition lost its image')
    assert(fullRecognition.messages.at(-1)?.status === 'completed', 'real Vision full recognition was not completed')
    assert(
      fullRecognition.messages.at(-1)?.content.trim().length >= fullRecognitionText.length,
      'real Vision persisted recognition is shorter than the rendered answer',
    )
    await evaluate(
      client,
      `document.querySelectorAll('.message-row.user').item(document.querySelectorAll('.message-row.user').length - 1)?.scrollIntoView({ block: 'start' })`,
    )
    await delay(300)
    screenshots.push(await screenshot(client, OUT_DIR, '09-real-vision-full-recognition-start', CAPTURE_SCREENSHOTS))
    await evaluate(
      client,
      `document.querySelectorAll('.message-row.assistant').item(document.querySelectorAll('.message-row.assistant').length - 1)?.scrollIntoView({ block: 'end' })`,
    )
    await delay(300)
    screenshots.push(await screenshot(client, OUT_DIR, '10-real-vision-full-recognition-end', CAPTURE_SCREENSHOTS))

    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 820,
      deviceScaleFactor: 1,
      mobile: true,
    })
    const mobile = await evaluate(client, `(() => {
      const names = ['.chat-main', '.message-row.user', '.message-attachment-grid', '.composer-inner'];
      return Object.fromEntries(names.map((name) => {
        const rect = document.querySelector(name)?.getBoundingClientRect();
        return [name, rect ? { left: rect.left, right: rect.right } : null];
      }));
    })()`)
    for (const [name, rect] of Object.entries(mobile)) {
      assert(rect && rect.left >= 0 && rect.right <= 390, `real Vision mobile ${name} is clipped`)
    }
    screenshots.push(await screenshot(client, OUT_DIR, '11-real-vision-mobile', CAPTURE_SCREENSHOTS))

    const zipResponse = await api('conversations/export.zip')
    const archive = unzipSync(new Uint8Array(await zipResponse.arrayBuffer()))
    const manifest = JSON.parse(strFromU8(archive['manifest.json']))
    assert(manifest.schemaVersion === 2, 'real portable ZIP schema version is not 2')
    assert(manifest.attachments.length >= 4, 'real portable ZIP omitted Vision attachments')
    for (const record of manifest.attachments) {
      assert(archive[record.path]?.length === record.byteSize, `real portable ZIP attachment size mismatch: ${record.id}`)
      assert(
        createHash('sha256').update(archive[record.path]).digest('hex') === record.sha256,
        `real portable ZIP attachment checksum mismatch: ${record.id}`,
      )
    }

    Object.assign(assertions, {
      model: VISION_MODEL,
      pureTextToolAnswer: pureTextAnswer,
      recognition: recognitionText,
      completedAttachmentId: attachment.id,
      contextPreview: preview.stats,
      branchAttachmentId: branch.messages.at(-2).attachments[0].id,
      imageOnlyAnswerLength: imageOnlyText.length,
      stoppedStatus: stopped.messages.at(-1).status,
      recoveryAnswerLength: recoveryText.length,
      fullRecognition: {
        length: fullRecognitionText.length,
        includesBooks: /书/.test(fullRecognitionText),
        includesVessel: /(容器|茶壶|茶杯|马黛|葫芦|杯)/.test(fullRecognitionText),
      },
      portableAttachmentCount: manifest.attachments.length,
      mobile,
    })
    console.log(JSON.stringify({ allPassed: true, assertions, screenshots: screenshots.filter(Boolean) }, null, 2))
  } catch (error) {
    if (client) {
      screenshots.push(await screenshot(client, OUT_DIR, '99-real-vision-failure', true).catch(() => null))
    }
    throw error
  } finally {
    client?.close()
    await stopProcess(chrome)
    await cleanupCreatedConversations(preservedIds)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
