// prompt.compose runs once per request, outermost tier first. A hook with more
// authority than Topia's (a managed plugin, or one ahead of it in the chain)
// may send the event on past it with next.to, and then Topia's sections never
// reach the model. That is the chain working as designed, often an
// organization's policy, so Topia does not route the text around it: it
// notices, says so once, and stops describing the sections as sent.

export type ComposeWatch = { isComposed: boolean; isBypassed: boolean }

export const UNSEEN: ComposeWatch = { isComposed: false, isBypassed: false }

/**
 * A main-loop turn that answered and counted usage sent at least one request,
 * and every request renders a system prompt.
 */
export function sentRequest(turn: { agentId?: string; reason: string; usage?: unknown }): boolean {
  return turn.agentId === undefined && turn.reason === 'answer' && turn.usage !== undefined
}

/** Whether this turn shows Topia's compose hook was skipped, the first time it does. */
export function isNewBypass(watch: ComposeWatch, missing: readonly string[]): boolean {
  return !watch.isComposed && !watch.isBypassed && missing.length > 0
}

export function bypassText(missing: readonly string[]): string {
  const what = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
  return `topia: ${what} are not reaching the model this session. ${BYPASS_REASON}`
}

export const BYPASS_REASON =
  "A plugin that runs ahead of Topia sends the system prompt on past Topia's hook; `claude --debug` names it. If your organization manages that plugin, this is its policy and Topia leaves it alone."

export const BYPASS_NOTE = `Not reaching the model this session. ${BYPASS_REASON}`

// The same chain can skip Topia's Salesforce guard. A person-gated tool asks the
// chain about a line the guard always catches, and refuses when the guard didn't
// answer. That shows the guard is in the chain now. It isn't a boundary: see
// docs/salesforce/README.md.
export const GUARD_MISSING =
  "Topia's Salesforce guard isn't answering in this session, so tools that need a person are refused. A plugin ahead of Topia may be answering for it; `claude --debug` names it."

