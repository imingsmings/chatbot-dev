import {
  clickText,
  evaluate,
  runScenarioModule,
  waitFor,
} from './harness.mjs'

const STORAGE_KEY = 'chatbot-custom-prompt-templates'

async function clickAria(client, label) {
  const clicked = await evaluate(
    client,
    `(() => {
      const button = document.querySelector(${JSON.stringify(`button[aria-label="${label}"]`)});
      if (!button) return false;
      button.click();
      return true;
    })()`,
  )
  if (!clicked) throw new Error(`Cannot find button: ${label}`)
}

async function setField(client, label, value) {
  await evaluate(
    client,
    `(() => {
      const field = [...document.querySelectorAll('.template-modal .settings-field')]
        .find((item) => item.querySelector('span')?.textContent.trim() === ${JSON.stringify(label)});
      const input = field?.querySelector('input, textarea');
      if (!input) throw new Error('Cannot find template field: ${label}');
      const prototype = input instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`,
  )
}

async function uploadJson(client, value) {
  await evaluate(
    client,
    `(() => {
      const input = document.querySelector('input[aria-label="导入模板文件"]');
      if (!input) throw new Error('Cannot find template import input');
      const file = new File([${JSON.stringify(value)}], 'prompt-templates.json', {
        type: 'application/json'
      });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      Object.defineProperty(input, 'files', { configurable: true, value: transfer.files });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    })()`,
  )
}

async function openTemplates(client) {
  await waitFor(
    client,
    `document.querySelector('button[aria-label="更多操作"]')?.disabled === false`,
  )
  await clickText(client, 'button', '模板')
  await waitFor(client, `Boolean(document.querySelector('.template-modal'))`)
}

export async function runPromptTemplates(client) {
  console.log('UI stage: custom prompt template CRUD, persistence, import, and export')
  await evaluate(client, `localStorage.removeItem(${JSON.stringify(STORAGE_KEY)})`)
  await client.send('Page.reload')
  await waitFor(client, `Boolean(document.querySelector('.composer textarea'))`)
  await openTemplates(client)

  const initial = await evaluate(client, `(() => ({
    builtInCount: document.querySelectorAll('.template-list-item:not([data-custom-template])').length,
    customCount: document.querySelectorAll('[data-custom-template="true"]').length,
    exportDisabled: document.querySelector('button[aria-label="导出模板"]')?.disabled,
  }))()`)
  if (initial.builtInCount !== 6 || initial.customCount !== 0 || initial.exportDisabled !== true) {
    throw new Error(`Initial prompt template state failed: ${JSON.stringify(initial)}`)
  }

  await clickAria(client, '新建模板')
  await setField(client, '模板名称', 'CDP 自定义分析')
  await setField(client, '模板内容', '请分析 {主题}：\n\n{内容}')
  await clickText(client, 'button', '保存模板')
  await waitFor(client, `document.querySelector('.template-modal output')?.textContent.includes('已创建')`)

  const created = await evaluate(client, `(() => {
    const stored = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}));
    return {
      schemaVersion: stored.schemaVersion,
      count: stored.templates.length,
      name: stored.templates[0].name,
      id: stored.templates[0].id,
      topicIsInput: document.querySelector('#prompt-template-主题') instanceof HTMLInputElement,
      contentIsTextarea: document.querySelector('#prompt-template-内容') instanceof HTMLTextAreaElement,
    };
  })()`)
  if (
    created.schemaVersion !== 1 ||
    created.count !== 1 ||
    created.name !== 'CDP 自定义分析' ||
    !created.id?.startsWith('custom-') ||
    !created.topicIsInput ||
    !created.contentIsTextarea
  ) {
    throw new Error(`Created prompt template mismatch: ${JSON.stringify(created)}`)
  }

  await setField(client, '主题', 'NDJSON')
  await setField(client, '内容', '验证流式边界')
  await clickText(client, 'button', '填入输入框')
  await waitFor(client, `!document.querySelector('.template-modal')`)
  const applied = await evaluate(
    client,
    `document.querySelector('.composer textarea')?.value === '请分析 NDJSON：\\n\\n验证流式边界'`,
  )
  if (!applied) throw new Error('Custom prompt template was not applied to the composer')

  await client.send('Page.reload')
  await waitFor(client, `Boolean(document.querySelector('.composer textarea'))`)
  await openTemplates(client)
  await waitFor(client, `Boolean(document.querySelector('[data-custom-template="true"]'))`)
  await clickText(client, 'button', 'CDP 自定义分析')
  await clickAria(client, '编辑自定义模板')
  await setField(client, '模板名称', 'CDP 自定义分析已编辑')
  await clickText(client, 'button', '保存模板')
  await waitFor(client, `document.querySelector('.template-modal output')?.textContent.includes('已更新')`)

  await evaluate(client, `(() => {
    window.__promptTemplateDownloads = [];
    let nextIndex = 0;
    URL.createObjectURL = (blob) => {
      const url = 'blob:prompt-template-' + ++nextIndex;
      blob.text().then((text) => window.__promptTemplateDownloads.push({ url, text }));
      return url;
    };
    URL.revokeObjectURL = () => {};
    HTMLAnchorElement.prototype.click = function () {
      window.__promptTemplateDownloadName = this.download;
    };
  })()`)
  await clickAria(client, '导出模板')
  await waitFor(client, `window.__promptTemplateDownloads?.length === 1`)
  const exported = await evaluate(client, `(() => {
    const documentValue = JSON.parse(window.__promptTemplateDownloads[0].text);
    return {
      filename: window.__promptTemplateDownloadName,
      schemaVersion: documentValue.schemaVersion,
      count: documentValue.templates.length,
      name: documentValue.templates[0].name,
    };
  })()`)
  if (
    !/^chatbot-prompt-templates-\d{4}-\d{2}-\d{2}\.json$/.test(exported.filename) ||
    exported.schemaVersion !== 1 ||
    exported.count !== 1 ||
    exported.name !== 'CDP 自定义分析已编辑'
  ) {
    throw new Error(`Prompt template export failed: ${JSON.stringify(exported)}`)
  }

  const importDocument = await evaluate(client, `(() => {
    const stored = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}));
    return JSON.stringify({
      schemaVersion: 1,
      templates: [
        { ...stored.templates[0], name: 'CDP ID 冲突副本', content: '冲突内容' },
        { id: 'custom-cdp-fresh', name: 'CDP 导入新增', content: '导入 {主题}' },
      ],
    });
  })()`)
  await uploadJson(client, importDocument)
  await waitFor(client, `document.querySelector('.template-modal output')?.textContent.includes('新增 1，冲突副本 1')`)
  const imported = await evaluate(client, `(() => {
    const stored = JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)}));
    return {
      count: stored.templates.length,
      uniqueIds: new Set(stored.templates.map((template) => template.id)).size,
      visibleCustomCount: document.querySelectorAll('[data-custom-template="true"]').length,
    };
  })()`)
  if (imported.count !== 3 || imported.uniqueIds !== 3 || imported.visibleCustomCount !== 3) {
    throw new Error(`Prompt template import failed: ${JSON.stringify(imported)}`)
  }

  const beforeMalformed = imported.count
  await uploadJson(client, '{bad json')
  await waitFor(client, `document.querySelector('.template-modal [role="alert"]')?.textContent.includes('有效的 JSON')`)
  const afterMalformed = await evaluate(
    client,
    `JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).templates.length`,
  )
  if (afterMalformed !== beforeMalformed) throw new Error('Malformed import changed stored templates')

  await clickAria(client, '删除自定义模板')
  const countBeforeConfirmation = await evaluate(
    client,
    `JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).templates.length`,
  )
  await clickAria(client, '确认删除自定义模板')
  await waitFor(
    client,
    `JSON.parse(localStorage.getItem(${JSON.stringify(STORAGE_KEY)})).templates.length === 2`,
  )
  if (countBeforeConfirmation !== 3) throw new Error('First delete click removed a template')

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
  })
  const mobile = await evaluate(client, `(() => ({
    noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth,
    dialogVisible: document.querySelector('.template-modal')?.getBoundingClientRect().height > 0,
    toolbarContained: document.querySelector('.template-toolbar')?.scrollWidth <=
      document.querySelector('.template-sidebar')?.clientWidth,
  }))()`)
  if (!Object.values(mobile).every(Boolean)) {
    throw new Error(`Prompt template mobile layout failed: ${JSON.stringify(mobile)}`)
  }

  return {
    initial,
    created,
    applied,
    exported,
    imported,
    malformedPreservedCount: afterMalformed,
    deletedCount: 2,
    mobile,
  }
}

runScenarioModule(
  import.meta.url,
  'prompt-templates',
  runPromptTemplates,
)
