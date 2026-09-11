import { pathToFileURL } from 'node:url'
import { closeUiHarness, createUiHarness } from './scenarios/ui/harness.mjs'
import { runConversationOperations } from './scenarios/ui/conversation-operations.mjs'
import { runLayoutScroll } from './scenarios/ui/layout-scroll.mjs'
import { runModelMenu } from './scenarios/ui/model-menu.mjs'
import { runMobileChatLayout } from './scenarios/ui/mobile-chat-layout.mjs'
import { runStreamRecovery } from './scenarios/ui/stream-recovery.mjs'
import { runWorkspaceLayout } from './scenarios/ui/workspace-layout.mjs'

const scenarioRunners = new Map([
  ['conversation-operations', runConversationOperations],
  ['model-menu', runModelMenu],
  ['stream-recovery', runStreamRecovery],
  ['layout-scroll', runLayoutScroll],
  ['workspace-layout', runWorkspaceLayout],
  ['mobile-chat-layout', runMobileChatLayout],
])

async function runUiScenarioGroup(group = process.env.CDP_UI_GROUP || 'all') {
  const selected = group === 'all'
    ? [...scenarioRunners.entries()]
    : [[group, scenarioRunners.get(group)]]
  if (selected.some(([, runner]) => typeof runner !== 'function')) {
    throw new Error(`Unknown UI scenario group: ${group}`)
  }

  const harness = await createUiHarness(group)
  const results = {}
  try {
    for (const [, runner] of selected) {
      Object.assign(results, await runner(harness.client))
    }
    console.log(JSON.stringify({ group, ...results }, null, 2))
  } finally {
    await closeUiHarness(harness)
  }
}

export { runUiScenarioGroup }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runUiScenarioGroup().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
