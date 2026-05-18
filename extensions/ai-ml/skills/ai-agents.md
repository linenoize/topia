---
name: "ai-agents"
pack: "@Topia/ai-ml"
description: "Stateful AI agent architecture — persistent state, callable RPC methods, scheduling, multi-agent coordination, MCP server integration, and real-time client communication via WebSocket."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# ai-agents

Stateful AI agent architecture — persistent state, callable RPC methods, scheduling, multi-agent coordination, MCP server integration, and real-time client communication via WebSocket. Covers agent lifecycle, state management patterns, tool registration, human-in-the-loop approval flows, and durable workflow orchestration for long-running agent tasks.

#### Workflow

**Step 1 — Classify agent type**
Identify what the agent needs to do and map to an architecture:

| Agent Type | Key Characteristics | Platform Options |
|---|---|---|
| Stateless tool-caller | Single request → tool calls → response. No memory between requests. | Any LLM API + function calling |
| Conversational with memory | Multi-turn dialogue. Needs chat history persistence. | Session store (Redis, KV) + LLM |
| Stateful autonomous | Persistent state, scheduled tasks, reacts to events. Long-lived. | Cloudflare Agents SDK, LangGraph, CrewAI |
| Multi-agent coordinator | Multiple specialized agents collaborating on a task. | LangGraph, AutoGen, custom orchestrator |
| MCP server | Exposes tools/resources to any MCP-compatible client. | Cloudflare McpAgent, custom MCP server |

**Step 2 — Design state management**
For stateful agents, define the state contract:

```typescript
// State must be serializable (JSON-safe) — no functions, no circular refs
interface AgentState {
  // Domain state
  conversations: ConversationEntry[];
  preferences: Record<string, string>;
  taskQueue: ScheduledTask[];

  // Metadata
  createdAt: string;
  lastActiveAt: string;
  version: number;
}

// State validation — reject invalid transitions
function validateStateChange(current: AgentState, next: AgentState): void {
  if (next.version < current.version) {
    throw new Error('State version cannot decrease — concurrent modification detected');
  }
  if (next.conversations.length > 10_000) {
    throw new Error('Conversation limit exceeded — archive old entries first');
  }
}
```

**Step 3 — Implement tool registration**
Define agent capabilities as typed, callable methods:

```typescript
// Tools as typed RPC methods (Cloudflare Agents SDK pattern)
import { Agent, callable } from 'agents';

export class ResearchAgent extends Agent<Env, ResearchState> {
  initialState: ResearchState = { findings: [], status: 'idle' };

  @callable()
  async search(query: string): Promise<SearchResult[]> {
    this.setState({ ...this.state, status: 'searching' });
    const results = await this.env.AI.run('@cf/meta/llama-3-8b-instruct', {
      prompt: `Search for: ${query}`,
    });
    const findings = parseResults(results);
    this.setState({
      ...this.state,
      findings: [...this.state.findings, ...findings],
      status: 'idle',
    });
    return findings;
  }

  @callable()
  async summarize(): Promise<string> {
    if (this.state.findings.length === 0) {
      throw new Error('No findings to summarize — run search first');
    }
    return generateSummary(this.state.findings);
  }
}
```

**Step 4 — Add scheduling and durability**
For agents that need to perform work on a schedule or survive restarts:

```typescript
// Scheduled tasks — one-time, recurring, and cron
@callable()
async scheduleDigest(userId: string) {
  // Daily digest at 9 AM
  await this.schedule('0 9 * * *', 'sendDigest', { userId });

  // One-time reminder in 1 hour
  await this.schedule(3600, 'sendReminder', { userId, message: 'Check results' });

  // Recurring every 30 minutes
  await this.scheduleEvery(1800, 'pollDataSource');
}

// Handler runs when scheduled time arrives — even if agent was hibernated
async onScheduledTask(task: ScheduledTask) {
  switch (task.type) {
    case 'sendDigest':
      await this.compileAndSendDigest(task.payload.userId);
      break;
    case 'pollDataSource':
      const newData = await fetchLatest();
      if (newData.length > 0) {
        this.setState({ ...this.state, lastPoll: Date.now(), data: newData });
      }
      break;
  }
}
```

**Step 5 — Human-in-the-loop patterns**
For agents that need approval before taking high-impact actions:

```typescript
// Approval flow — agent pauses, human approves, agent resumes
interface PendingApproval {
  id: string;
  action: string;
  params: Record<string, unknown>;
  requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
}

@callable()
async requestApproval(action: string, params: Record<string, unknown>): Promise<string> {
  const approval: PendingApproval = {
    id: crypto.randomUUID(),
    action,
    params,
    requestedAt: new Date().toISOString(),
    status: 'pending',
  };
  this.setState({
    ...this.state,
    pendingApprovals: [...this.state.pendingApprovals, approval],
  });
  // Client receives state update via WebSocket → shows approval UI
  return approval.id;
}

@callable()
async resolveApproval(id: string, decision: 'approved' | 'rejected') {
  const updated = this.state.pendingApprovals.map(a =>
    a.id === id ? { ...a, status: decision } : a
  );
  this.setState({ ...this.state, pendingApprovals: updated });
  if (decision === 'approved') {
    const approval = updated.find(a => a.id === id)!;
    await this.executeAction(approval.action, approval.params);
  }
}
```

#### Sharp Edges

| Failure Mode | Mitigation |
|---|---|
| State grows unbounded (conversation history, logs) | Implement max size limits with archival; pTopia old entries on state update |
| Concurrent state mutations from multiple clients | Use version counter in state; reject updates with stale version |
| Agent crashes mid-workflow, loses progress | Use durable workflows (Cloudflare Workflows, Temporal) for multi-step tasks — each step is persisted |
| Scheduled tasks pile up during agent hibernation | Deduplicate on wake-up; use idempotency keys for task handlers |
