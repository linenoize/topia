---
name: "server-setup"
pack: "@Topia/devops"
description: "Server configuration — Nginx/Caddy reverse proxy, systemd services, firewall rules, SSH hardening, automatic updates."
model: sonnet
tools: [Read, Edit, Write, Grep, Glob, Bash]
---

# server-setup

Server configuration — Nginx/Caddy reverse proxy, systemd services, firewall rules, SSH hardening, automatic updates.

#### Workflow

**Step 1 — Detect server environment**
Check for `nginx.conf`, `Caddyfile`, `*.service` (systemd), `ufw` or `iptables` rules, `sshd_config` presence. Identify the reverse proxy, process manager, and OS-level security configuration.

**Step 2 — Audit server hardening**
Check for: SSH password auth enabled (should be key-only), root SSH login enabled (should be disabled), no firewall rules (should allow only 22, 80, 443), no rate limiting on Nginx, missing security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`), process running as root.

**Step 3 — Emit hardened configuration**
Emit the corrected configs: Nginx with security headers, rate limiting, and gzip; systemd service with `User=`, `Restart=`, and resource limits; SSH hardening (`PermitRootLogin no`, `PasswordAuthentication no`); firewall rules allowing only necessary ports.

#### Example

```nginx
# Nginx reverse proxy — hardened
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name example.com;

    ssl_certificate /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;

    # Security headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    location /api/ {
        limit_req zone=api burst=20 nodelay;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Request-Id $request_id;
    }

    location / {
        root /var/www/app/dist;
        try_files $uri $uri/ /index.html;
        gzip on;
        gzip_types text/plain text/css application/json application/javascript;
    }
}
```
