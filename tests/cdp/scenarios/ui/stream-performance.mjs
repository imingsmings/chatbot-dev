import {
  ask,
  clickText,
  delay,
  evaluate,
  resetPage,
  runScenarioModule,
  seedConversations,
  setPlan,
  waitFor,
  waitIdle,
} from './harness.mjs'

const BASELINE_MODE = process.env.CDP_STREAM_PERFORMANCE_MODE === 'baseline'
const RUN_COUNT = 5

function createChunks(label, totalLength, chunkLength, markdown = false) {
  const chunks = []
  let length = 0
  let index = 0
  while (length < totalLength) {
    index += 1
    const prefix = markdown
      ? `## ${label} ${index}\n\n- item ${index}\n\n\`code-${index}\` `
      : `${label} ${index} `
    const content = `${prefix}${'内容'.repeat(Math.max(1, Math.floor((chunkLength - prefix.length) / 2)))}\n`
    chunks.push(content)
    length += content.length
  }
  chunks.push(`\n${label}-END`)
  return chunks
}

function percentile(values, ratio) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]
}

function median(values) {
  return percentile(values, 0.5)
}

async function startDiagnostics(client) {
  await evaluate(client, `(() => {
    window.__chatbotPerformanceDiagnostics = { enabled: true, marks: [] };
    const state = {
      completedAt: null,
      lastSignature: '',
      longTasks: [],
      visibleUpdates: [],
    };
    const capture = () => {
      const rows = [...document.querySelectorAll('.message-row.assistant')];
      const row = rows[rows.length - 1];
      if (!row) return;
      const text = row.querySelector('.markdown-message')?.textContent || '';
      const reasoning = row.querySelector('.reasoning-content-body')?.textContent || '';
      const status = row.querySelector('.message-status-text')?.textContent || '';
      if (!text && !reasoning) return;
      const signature = reasoning + '\\u0000' + text + '\\u0000' + status;
      if (signature !== state.lastSignature) {
        state.lastSignature = signature;
        state.visibleUpdates.push({
          at: performance.now(),
          reasoningLength: reasoning.length,
          textLength: text.length,
        });
      }
      const markdown = row.querySelector('.markdown-message');
      if (markdown?.getAttribute('data-render-mode') === 'complete' && text) {
        state.completedAt ||= performance.now();
      }
    };
    const observer = new MutationObserver(capture);
    observer.observe(document.querySelector('.chat-scroll'), {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
      attributeFilter: ['data-render-mode'],
    });
    let longTaskObserver = null;
    if (typeof PerformanceObserver === 'function' &&
        PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          state.longTasks.push({ at: entry.startTime, duration: entry.duration });
        }
      });
      longTaskObserver.observe({ entryTypes: ['longtask'] });
    }
    window.__streamPerformanceState = { capture, longTaskObserver, observer, state };
  })()`)
}

async function stopDiagnostics(client) {
  await delay(120)
  return evaluate(client, `(() => {
    const diagnostics = window.__chatbotPerformanceDiagnostics || { marks: [] };
    const holder = window.__streamPerformanceState;
    holder?.capture();
    holder?.observer.disconnect();
    holder?.longTaskObserver?.disconnect();
    diagnostics.enabled = false;
    const marks = diagnostics.marks || [];
    const streamMarks = marks.filter((mark) => mark.name === 'stream-event');
    const textStreamMarks = streamMarks.filter((mark) =>
      mark.detail?.type === 'delta' || mark.detail?.type === 'reasoning_delta');
    const assistantMarks = marks.filter((mark) => mark.name === 'assistant-update');
    const activeMessageId = assistantMarks.find((mark) => mark.detail?.messageId)?.detail?.messageId;
    const doneAt = streamMarks.find((mark) => mark.detail?.type === 'done')?.at ?? Infinity;
    const firstStreamAt = textStreamMarks[0]?.at ?? null;
    const lastStreamAt = streamMarks[streamMarks.length - 1]?.at ?? null;
    const visible = holder?.state.visibleUpdates || [];
    const visibleIntervals = visible.slice(1).map((item, index) => item.at - visible[index].at);
    const scroll = document.querySelector('.chat-scroll');
    return {
      assistantUpdateCount: assistantMarks.length,
      bottomGap: scroll ? Math.round(scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight) : null,
      completionLatencyMs: holder?.state.completedAt && lastStreamAt
        ? holder.state.completedAt - lastStreamAt
        : null,
      firstVisibleLatencyMs: visible[0] && firstStreamAt ? visible[0].at - firstStreamAt : null,
      historyRowRendersDuringStream: marks.filter((mark) =>
        mark.name === 'message-row-render' &&
        mark.detail?.messageId !== activeMessageId &&
        firstStreamAt !== null &&
        mark.at >= firstStreamAt &&
        mark.at < doneAt).length,
      longTaskCount: holder?.state.longTasks.length || 0,
      longTaskTotalMs: (holder?.state.longTasks || []).reduce((sum, item) => sum + item.duration, 0),
      markdownRenderCount: marks.filter((mark) => mark.name === 'markdown-render').length,
      markdownRenderTotalMs: marks.filter((mark) => mark.name === 'markdown-render')
        .reduce((sum, mark) => sum + (Number(mark.detail?.durationMs) || 0), 0),
      rawEventCount: streamMarks.length,
      scrollExecutionCount: marks.filter((mark) => mark.name === 'scroll-execute').length,
      scrollScheduleCount: marks.filter((mark) => mark.name === 'scroll-schedule').length,
      visibleUpdateCount: visible.length,
      visibleUpdateIntervalP95Ms: ${percentile.toString()}(visibleIntervals, 0.95),
    };
  })()`)
}

async function runMeasured(client, scenario) {
  if (scenario.messages) {
    const now = new Date().toISOString()
    await seedConversations(client, [{
      id: `stream-performance-${scenario.name}`,
      title: `Stream performance ${scenario.name}`,
      createdAt: now,
      updatedAt: now,
      messages: scenario.messages,
    }])
    await evaluate(client, 'location.reload()')
    await waitFor(client, `document.querySelectorAll('.message-row').length === ${scenario.messages.length}`)
  } else {
    await resetPage(client)
  }

  await setPlan(client, [scenario.plan])
  await startDiagnostics(client)
  await ask(client, `性能测试 ${scenario.name}`)
  await waitFor(client, `document.body.innerText.includes(${JSON.stringify(scenario.marker)})`, 15_000)
  await waitIdle(client)
  const metrics = await stopDiagnostics(client)
  if (metrics.bottomGap === null || metrics.bottomGap > 96) {
    throw new Error(`${scenario.name} did not remain near the bottom: ${JSON.stringify(metrics)}`)
  }
  return metrics
}

function summarize(runs) {
  const fields = [
    'assistantUpdateCount',
    'completionLatencyMs',
    'firstVisibleLatencyMs',
    'historyRowRendersDuringStream',
    'longTaskCount',
    'longTaskTotalMs',
    'markdownRenderCount',
    'markdownRenderTotalMs',
    'rawEventCount',
    'scrollExecutionCount',
    'scrollScheduleCount',
    'visibleUpdateCount',
    'visibleUpdateIntervalP95Ms',
  ]
  return Object.fromEntries(fields.map((field) => {
    const values = runs.map((run) => Number(run[field]) || 0)
    return [field, { median: median(values), worst: Math.max(...values) }]
  }))
}

function createHistoryMessages() {
  return Array.from({ length: 200 }, (_, index) => ({
    role: index % 2 === 0 ? 'user' : 'assistant',
    content: `历史消息 ${index + 1} ${'上下文'.repeat(20)}`,
  }))
}

async function runBehaviorBoundaries(client) {
  await resetPage(client)
  await setPlan(client, [{
    kind: 'success',
    reasoningChunks: ['推理一。', '推理二。'],
    toolEvents: [
      { type: 'tool_start', toolCallId: 'perf-tool', name: 'calculate' },
      { type: 'tool_result', toolCallId: 'perf-tool', name: 'calculate', success: true, summary: '42' },
    ],
    chunks: ['边界正文一。', '边界正文二。'],
    interval: 15,
    done: false,
  }])
  await ask(client, '推理与工具边界')
  await waitFor(client, `document.body.innerText.includes('推理一。推理二。') &&
    document.body.innerText.includes('calculate') &&
    document.body.innerText.includes('42') &&
    document.body.innerText.includes('边界正文一。边界正文二。')`)
  const boundaryText = await evaluate(client, `document.querySelector('.message-row.assistant')?.innerText || ''`)
  if (!(boundaryText.indexOf('推理一') < boundaryText.indexOf('calculate') &&
      boundaryText.indexOf('calculate') < boundaryText.indexOf('边界正文一'))) {
    throw new Error(`Reasoning/tool/text order changed: ${boundaryText}`)
  }
  await clickText(client, 'button', '停止')
  await waitFor(client, `document.body.innerText.includes('已停止生成')`)

  await resetPage(client)
  await setPlan(client, [{
    kind: 'streamError',
    chunks: ['错误前文本一。', '错误前文本二。'],
    interval: 10,
    message: '性能场景模拟错误',
  }])
  await ask(client, '错误前冲刷')
  await waitFor(client, `document.body.innerText.includes('错误前文本一。错误前文本二。') &&
    document.body.innerText.includes('性能场景模拟错误')`)

  await resetPage(client)
  await setPlan(client, [{
    kind: 'success',
    chunks: createChunks('STOP', 20_000, 200),
    interval: 20,
    done: false,
  }])
  await ask(client, '停止前冲刷')
  await waitFor(client, `document.body.innerText.includes('STOP 4')`)
  await clickText(client, 'button', '停止')
  await waitFor(client, `document.body.innerText.includes('已停止生成')`)
  const stoppedLength = await evaluate(client, `document.querySelector('.message-row.assistant .markdown-message')?.textContent.length || 0`)
  if (stoppedLength <= 0) throw new Error('Manual stop lost all buffered text')

  return { boundaryOrder: true, errorFlushed: true, stoppedLength }
}

export async function runStreamPerformance(client) {
  console.log(`UI stage: stream performance (${BASELINE_MODE ? 'baseline' : 'optimized'})`)
  const shortChunks = createChunks('SHORT', 4_000, 200)
  const mediumChunks = createChunks('MEDIUM', 24_000, 400, true)
  const longChunks = createChunks('LONG', 80_000, 800, true)
  const historyChunks = createChunks('HISTORY', 8_000, 160)
  const scenarios = [
    { name: 'short', marker: 'SHORT-END', plan: { kind: 'success', chunks: shortChunks, interval: 20 } },
    { name: 'medium-markdown', marker: 'MEDIUM-END', plan: { kind: 'success', chunks: mediumChunks, interval: 10 } },
    { name: 'long-markdown', marker: 'LONG-END', plan: { kind: 'success', chunks: longChunks, interval: 5 } },
    {
      name: 'long-history',
      marker: 'HISTORY-END',
      messages: createHistoryMessages(),
      plan: { kind: 'success', chunks: historyChunks, interval: 10 },
    },
  ]
  const results = {}

  for (const scenario of scenarios) {
    const runs = []
    for (let run = 0; run < RUN_COUNT; run += 1) {
      runs.push(await runMeasured(client, scenario))
    }
    results[scenario.name] = { runs, summary: summarize(runs) }
  }

  const behavior = await runBehaviorBoundaries(client)

  if (!BASELINE_MODE) {
    for (const name of ['short', 'medium-markdown']) {
      const summary = results[name].summary
      if (summary.firstVisibleLatencyMs.worst > 50) {
        throw new Error(`${name} first visible latency exceeded 50ms: ${JSON.stringify(summary)}`)
      }
      if (summary.visibleUpdateIntervalP95Ms.worst > 120) {
        throw new Error(`${name} visible update P95 exceeded 120ms: ${JSON.stringify(summary)}`)
      }
      if (summary.assistantUpdateCount.median >= summary.rawEventCount.median * 0.6) {
        throw new Error(`${name} assistant updates were not bounded: ${JSON.stringify(summary)}`)
      }
    }
    if (results['long-history'].summary.historyRowRendersDuringStream.worst !== 0) {
      throw new Error(`Historical rows rerendered during streaming: ${JSON.stringify(results['long-history'].summary)}`)
    }
    if (results['medium-markdown'].summary.longTaskCount.worst > 0) {
      throw new Error(`Medium Markdown added long tasks: ${JSON.stringify(results['medium-markdown'].summary)}`)
    }
    const longMarkdownSummary = results['long-markdown'].summary
    if (longMarkdownSummary.firstVisibleLatencyMs.worst > 50) {
      throw new Error(`Long Markdown first visible latency exceeded 50ms: ${JSON.stringify(longMarkdownSummary)}`)
    }
    if (longMarkdownSummary.visibleUpdateIntervalP95Ms.worst > 240) {
      throw new Error(`Long Markdown visible update P95 exceeded 240ms: ${JSON.stringify(longMarkdownSummary)}`)
    }
    if (longMarkdownSummary.longTaskCount.worst > 0) {
      throw new Error(`Long Markdown added long tasks: ${JSON.stringify(longMarkdownSummary)}`)
    }
  }

  return { baseline: BASELINE_MODE, behavior, scenarios: results }
}

runScenarioModule(
  import.meta.url,
  'stream-performance',
  runStreamPerformance,
)
