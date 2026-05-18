---
name: "prompt-patterns"
pack: "@Topia/ai-ml"
description: "Reusable prompt engineering patterns — structured output, chain-of-thought, self-critique, tool use orchestration, and multi-turn memory management."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# prompt-patterns

Reusable prompt engineering patterns — structured output, chain-of-thought, self-critique, tool use orchestration, and multi-turn memory management.

#### Workflow

**Step 1 — Identify the pattern**
Match the user's task to a proven prompt pattern:
- **Extraction**: Use JSON mode + schema definition + few-shot examples
- **Classification**: Use enum output + confidence score + chain-of-thought
- **Summarization**: Use structured summary template + length constraint + key point extraction
- **Code generation**: Use system prompt with language constraints + test-driven output format
- **Agent loop**: Use ReAct pattern (Thought → Action → Observation → repeat)
- **Self-critique**: Use generate → critique → revise loop for quality-sensitive output

**Step 2 — Apply the pattern**
Generate the prompt following the selected pattern. Include:
- System prompt (role + constraints + output format)
- User message template (input variables marked with `{{variable}}`)
- Few-shot examples (2-3, matching exact output format)
- Validation schema (Zod/Pydantic for structured output)

**Step 3 — Test harness**
Emit a test file with 5+ test cases that validate the prompt produces correct output for known inputs. Include edge cases: empty input, very long input, ambiguous input, adversarial input.

#### Example

```typescript
// Pattern: ReAct Agent Loop
const REACT_SYSTEM = `You are an agent that solves tasks using available tools.

For each step, output EXACTLY this JSON format:
{"thought": "reasoning about what to do next",
 "action": "tool_name",
 "action_input": "input for the tool"}

After receiving an observation, continue with the next thought.
When you have the final answer, output:
{"thought": "I have the answer", "final_answer": "the answer"}

Available tools:
{{tools}}`;

// Pattern: Self-Critique Loop
async function generateWithCritique(prompt: string, maxRounds = 2) {
  let output = await llm.generate(prompt);

  for (let i = 0; i < maxRounds; i++) {
    const critique = await llm.generate(
      `Review this output for errors, omissions, and improvements:\n\n${output}\n\n` +
      `List specific issues. If no issues, respond with "APPROVED".`
    );

    if (critique.includes('APPROVED')) break;

    output = await llm.generate(
      `Original output:\n${output}\n\nCritique:\n${critique}\n\n` +
      `Revise the output to address all issues in the critique.`
    );
  }

  return output;
}
```
