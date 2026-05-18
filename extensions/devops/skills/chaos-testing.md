---
name: "chaos-testing"
pack: "@Topia/devops"
description: "Resilience testing — inject controlled failures to verify system behavior under degraded conditions. Validates circuit breakers, retry logic, graceful degradation, and recovery procedures."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# chaos-testing

Resilience testing — inject controlled failures to verify system behavior under degraded conditions. Validates circuit breakers, retry logic, graceful degradation, and recovery procedures.

#### Workflow

**Step 1 — Map failure points**
Scan the codebase for: external API calls (HTTP clients, SDK calls), database connections, message queues, cache layers, file system operations, and third-party services. For each dependency, identify: timeout configuration, retry logic, circuit breaker presence, fallback behavior. Build a dependency map with failure modes.

**Step 2 — Design chaos experiments**
For each critical dependency, define experiments:
- **Latency injection**: Add 2-5s delay to responses — does the UI show loading state? Do timeouts fire correctly?
- **Error injection**: Return 500/503 from dependency — does the circuit breaker open? Does fallback activate?
- **Partition**: Dependency becomes unreachable — does the system degrade gracefully or crash?
- **Data corruption**: Invalid response format — does validation catch it?

Each experiment has: hypothesis ("If Redis is down, the app serves stale cache for 5 minutes"), blast radius (which users/features affected), rollback procedure (how to stop the experiment).

**Step 3 — Generate test harnesses**
Emit test files that simulate each failure mode:
- Mock-based chaos for unit/integration tests (intercept HTTP, inject errors)
- Environment-variable-driven chaos for staging (feature flags to enable failure injection)
- Health check validation (verify `/health` endpoint reports degraded state, not crash)

Save experiment plan to `.topia/chaos/<date>-experiment.md`.

#### Example

```typescript
// Chaos test: Redis connection failure
describe('Chaos: Redis unavailable', () => {
  beforeEach(() => {
    // Simulate Redis connection refused
    jest.spyOn(redisClient, 'get').mockRejectedValue(
      new Error('ECONNREFUSED 127.0.0.1:6379')
    );
  });

  it('falls back to database when cache is down', async () => {
    const result = await getUserProfile('user-123');
    expect(result).toBeDefined(); // still works
    expect(dbClient.query).toHaveBeenCalled(); // used DB fallback
  });

  it('reports degraded health status', async () => {
    const health = await request(app).get('/health');
    expect(health.status).toBe(200);
    expect(health.body.cache).toBe('degraded');
    expect(health.body.overall).toBe('degraded'); // not 'down'
  });

  it('circuit breaker opens after 5 failures', async () => {
    for (let i = 0; i < 5; i++) await getUserProfile(`user-${i}`);
    // 6th call should not even attempt Redis
    await getUserProfile('user-6');
    expect(redisClient.get).toHaveBeenCalledTimes(5); // not 6
  });
});
```
