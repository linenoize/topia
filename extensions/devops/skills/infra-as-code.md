---
name: "infra-as-code"
pack: "@Topia/devops"
description: "Infrastructure-as-Code patterns — Terraform, Pulumi, and CDK for managing cloud infrastructure declaratively. Covers state management, module organization, secret handling, drift detection, and CI/CD integration for infrastructure changes."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# infra-as-code

Infrastructure-as-Code patterns — Terraform, Pulumi, and CDK for managing cloud infrastructure declaratively. Covers state management, module organization, secret handling, drift detection, and CI/CD integration for infrastructure changes.

#### Workflow

**Step 1 — Detect IaC tooling**
Use Glob to find `*.tf`, `terraform/`, `pulumi/`, `Pulumi.yaml`, `cdk.json`, `cdktf.json`, `*.tfvars`. Read configs to understand: provider (AWS/GCP/Cloudflare/Vercel), state backend (S3, Terraform Cloud, Pulumi Cloud), module structure, and variable management.

**Step 2 — Audit IaC best practices**
Check for:

| Issue | Detection | Severity |
|---|---|---|
| Local state (no remote backend) | `terraform.tfstate` in repo, no `backend` block | CRITICAL — state lost on disk failure, no locking |
| Secrets in `.tfvars` committed to git | Grep `.tfvars` for passwords, tokens, keys | CRITICAL — credential exposure |
| No state locking | S3 backend without DynamoDB table, or no locking config | HIGH — concurrent applies corrupt state |
| Hardcoded values instead of variables | Resource blocks with literal strings for env-specific values | MEDIUM — can't reuse across environments |
| Missing `lifecycle` blocks | Resources without `prevent_destroy` on critical infra (databases, storage) | HIGH — accidental deletion |
| No module structure | All resources in single `main.tf` | MEDIUM — unmaintainable at scale |
| No output definitions | Missing `output` blocks for cross-module references | LOW — harder to compose modules |

**Step 3 — Emit structured IaC project**
Generate or restructure into a modular layout:

```
infrastructure/
├── environments/
│   ├── dev/
│   │   ├── main.tf          # dev-specific overrides
│   │   ├── terraform.tfvars  # dev variables (no secrets!)
│   │   └── backend.tf       # dev state backend
│   ├── staging/
│   └── production/
├── modules/
│   ├── networking/           # VPC, subnets, security groups
│   ├── compute/              # EC2, ECS, Lambda, Workers
│   ├── database/             # RDS, D1, PlanetScale
│   └── monitoring/           # CloudWatch, alerts, dashboards
├── variables.tf              # shared variable definitions
├── outputs.tf                # exported values
└── versions.tf               # provider version constraints
```

**Step 4 — CI/CD for infrastructure**
Emit GitHub Actions workflow for safe infrastructure changes:

```yaml
# .github/workflows/infrastructure.yml
name: Infrastructure
on:
  pull_request:
    paths: ['infrastructure/**']
  push:
    branches: [main]
    paths: ['infrastructure/**']

jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - run: terraform init
        working-directory: infrastructure/environments/production
      - run: terraform plan -out=tfplan -no-color
        working-directory: infrastructure/environments/production
      - uses: actions/upload-artifact@v4
        with:
          name: tfplan
          path: infrastructure/environments/production/tfplan

  apply:
    needs: plan
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    environment: production  # requires manual approval
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
      - uses: actions/download-artifact@v4
        with: { name: tfplan }
      - run: terraform init && terraform apply tfplan
        working-directory: infrastructure/environments/production
```

#### Example — Terraform Module

```hcl
# modules/compute/workers/main.tf
# Cloudflare Workers deployment via Terraform

variable "name" {
  type        = string
  description = "Worker script name"
}

variable "account_id" {
  type      = string
  sensitive = true
}

variable "script_path" {
  type        = string
  description = "Path to compiled Worker script"
}

variable "kv_namespaces" {
  type    = map(string)
  default = {}
}

resource "cloudflare_workers_script" "worker" {
  account_id = var.account_id
  name       = var.name
  content    = file(var.script_path)
  module     = true

  dynamic "kv_namespace_binding" {
    for_each = var.kv_namespaces
    content {
      name         = kv_namespace_binding.key
      namespace_id = kv_namespace_binding.value
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "cloudflare_workers_route" "route" {
  zone_id     = var.zone_id
  pattern     = "${var.domain}/*"
  script_name = cloudflare_workers_script.worker.name
}

output "script_id" {
  value = cloudflare_workers_script.worker.id
}
```

#### Sharp Edges

| Failure Mode | Mitigation |
|---|---|
| `terraform destroy` on production without confirmation | Always use `lifecycle { prevent_destroy = true }` on databases, storage, DNS |
| State file contains secrets in plaintext | Use encrypted S3 backend or Terraform Cloud; never commit state to git |
| Module version unpinned — breaking change on next init | Pin module versions: `source = "hashicorp/consul/aws"` with `version = "~> 0.12"` |
| Drift between actual infra and state | Run `terraform plan` in CI on schedule (daily) to detect drift early |
