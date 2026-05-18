---
name: "fine-tuning-guide"
pack: "@Topia/ai-ml"
description: "Fine-tuning workflows — dataset preparation, training configuration, evaluation metrics, deployment, A/B testing."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# fine-tuning-guide

Fine-tuning workflows — dataset preparation, training configuration, evaluation metrics, deployment, A/B testing.

#### Workflow

**Step 1 — Audit training data**
Use Read to examine the dataset files. Check for: data format (JSONL with `messages` array), train/eval split (eval must not overlap with train), sufficient examples (minimum 50, recommended 200+), balanced class distribution, and PII in training data.

**Step 2 — Prepare and validate dataset**
Emit: JSONL formatter that validates each example, train/eval splitter with stratification, token count estimator (cost preview), and data quality checks (duplicate detection, format validation).

**Step 3 — Execute fine-tuning and evaluate**
Emit: fine-tune API call with hyperparameters, evaluation script that compares base vs fine-tuned on held-out set, and A/B deployment configuration.

#### Example

```python
# Fine-tuning workflow — prepare, train, evaluate
import json
import openai
from sklearn.model_selection import train_test_split

# Step 1: Prepare JSONL dataset
def prepare_dataset(examples: list[dict], output_prefix: str):
    train, eval_set = train_test_split(examples, test_size=0.2, random_state=42)

    for split_name, split_data in [("train", train), ("eval", eval_set)]:
        path = f"{output_prefix}_{split_name}.jsonl"
        with open(path, "w") as f:
            for ex in split_data:
                f.write(json.dumps({"messages": [
                    {"role": "system", "content": ex["system"]},
                    {"role": "user", "content": ex["input"]},
                    {"role": "assistant", "content": ex["output"]},
                ]}) + "\n")
        print(f"Wrote {len(split_data)} examples to {path}")

# Step 2: Launch fine-tuning
def start_fine_tune(train_file: str, eval_file: str):
    train_id = openai.files.create(file=open(train_file, "rb"), purpose="fine-tune").id
    eval_id = openai.files.create(file=open(eval_file, "rb"), purpose="fine-tune").id

    job = openai.fine_tuning.jobs.create(
        training_file=train_id,
        validation_file=eval_id,
        model="gpt-4o-mini-2024-07-18",
        hyperparameters={"n_epochs": 3, "batch_size": "auto", "learning_rate_multiplier": "auto"},
    )
    print(f"Fine-tuning job: {job.id} — status: {job.status}")
    return job

# Step 3: Evaluate base vs fine-tuned
def evaluate(base_model: str, ft_model: str, eval_set: list[dict]) -> dict:
    results = {"base": {"correct": 0}, "finetuned": {"correct": 0}}
    for ex in eval_set:
        for label, model in [("base", base_model), ("finetuned", ft_model)]:
            response = openai.chat.completions.create(
                model=model, messages=ex["messages"][:2], max_tokens=500,
            )
            if response.choices[0].message.content.strip() == ex["messages"][2]["content"].strip():
                results[label]["correct"] += 1
    for label in results:
        results[label]["accuracy"] = results[label]["correct"] / len(eval_set)
    return results
```
