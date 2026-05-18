---
name: "kubernetes"
pack: "@Topia/devops"
description: "Kubernetes resource patterns — Deployments, Services, ConfigMaps, resource limits, health probes, HPA, network policies, and RBAC."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# kubernetes

Kubernetes resource patterns — Deployments, Services, ConfigMaps, resource limits, health probes, HPA, network policies, and RBAC.

#### Workflow

**Step 1 — Detect Kubernetes configuration**
Use Glob to find `k8s/`, `kubernetes/`, `manifests/`, `helm/`, `kustomize/`, or any `.yaml` files with `apiVersion: apps/v1`. Read existing manifests to understand: workload types, resource limits, probe configuration, service exposure, and secret management.

**Step 2 — Audit against production readiness**
Check for: missing resource requests/limits (noisy neighbor risk), no readiness/liveness probes (unhealthy pods receive traffic), `latest` image tag (non-reproducible), missing PodDisruptionBudget (risky rolling updates), no NetworkPolicy (unrestricted pod-to-pod traffic), secrets in plain ConfigMap (should use Secrets or external vault), no HPA (can't auto-scale), privileged containers.

**Step 3 — Emit production-ready manifests**
Generate or patch manifests: Deployment with resource limits, probes, and anti-affinity; Service with proper selector; HPA with CPU/memory targets; NetworkPolicy restricting ingress; PDB for safe rollouts; Kustomize overlays for dev/staging/prod environments.

#### Example

```yaml
# Production-ready Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  labels:
    app: api-server
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
    spec:
      containers:
        - name: api
          image: registry.example.com/api:v1.4.2  # pinned tag
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
            limits:
              cpu: 500m
              memory: 512Mi
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 15
            periodSeconds: 20
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: api-secrets
                  key: database-url
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchLabels:
                    app: api-server
                topologyKey: kubernetes.io/hostname
---
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: api-server-pdb
spec:
  minAvailable: 2
  selector:
    matchLabels:
      app: api-server
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-server-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 3
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```
