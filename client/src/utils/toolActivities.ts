import type { ToolActivity } from '@/types/chat'

type InterruptedToolStatus = Extract<ToolActivity['status'], 'error' | 'stopped'>

export function settleRunningToolActivities(
  activities: ToolActivity[] | undefined,
  status: InterruptedToolStatus,
  summary: string,
): ToolActivity[] {
  if (!activities?.some((activity) => activity.status === 'running')) {
    return activities ?? []
  }

  return activities.map((activity) =>
    activity.status === 'running'
      ? {
          ...activity,
          status,
          summary,
        }
      : activity,
  )
}
