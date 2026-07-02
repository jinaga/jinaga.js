# WebSocket Subscription Protocol — Cloud Deployment Guide

The protocol in [`websocket-protocol-spec.md`](./websocket-protocol-spec.md) must run
behind the load balancers and ingresses of Azure, AWS, and GCP — App Service,
Container Apps, AKS, ALB, Cloud Run, GKE, VMs, and the rest. This document records
the platform constraints that drove the protocol's liveness and reconnection
parameters, and gives operators a per-platform checklist. Research date: July 2026;
all cited limits were verified against vendor documentation then — recheck before
relying on a specific number.

## 1. How platform constraints shaped the protocol

Three classes of intermediary behavior matter to a long-lived multiplexed WebSocket:

1. **Idle timeouts.** Every platform severs a connection that carries no bytes for
   some window — often silently (Azure Load Balancer drops without TCP RST by
   default). The protocol's server heartbeat (§5.6 of the spec: protocol ping +
   `PING` frame, default every 20 s) exists to keep every surveyed idle timer fed and
   to detect the silent drops. Non-configurable idle floors: Azure App Service ≈
   230 s, Azure Container Apps 240 s (default ingress), Azure Front Door 5 min, AWS
   NLB-TLS 350 s. Configurable-but-forgotten defaults are much tighter — 20–60 s
   (§3's knob checklist).
2. **Maximum connection lifetimes.** Some platforms cap even an active connection:
   Cloud Run 60 min (request-timeout ceiling), App Engine flexible 1 h, AWS API
   Gateway WebSocket APIs 2 h, Azure Front Door 4 h, GCP global external ALB 24 h.
   The protocol's **connection lease** (§7 of the spec) turns these forced cuts into
   planned, bookmark-resumed reconnects. Default `leaseSeconds`: **50 minutes**
   ±10 % jitter — under every cap above, and conveniently near typical 60-minute
   token TTLs (renew via in-band `AUTH`, §4.1). Operators on platforms with no cap
   MAY disable the lease; the cost of keeping it is one round trip of catch-up per
   cycle.
3. **Drain windows.** Scale-in and deploys deliver SIGTERM with short grace:
   Kubernetes 30 s default, Azure Container Apps 30 s fixed, ECS 30 s (Fargate max
   120 s). Removing an endpoint from a target group stops *new* traffic only;
   established WebSockets survive until the process dies and are then severed with
   no close frame. Hence the spec's drain rule: on SIGTERM, stop accepting
   upgrades, send `1012` staggered across the grace window, exit early when sockets
   close.

The heartbeat interval, watchdog, lease, and drain behavior are therefore not
tunables to rediscover per deployment — they are derived from this matrix and safe
everywhere; only the ingress knobs in §3 need per-platform action.

## 2. Platform support matrix

"Idle" = idle timeout (default → max). "Lifetime" = maximum connection lifetime even
when active. Blank = none documented.

### Azure

| Platform | Enable WS | Idle | Lifetime | Notes |
|---|---|---|---|---|
| App Service (Windows) | `webSocketsEnabled` (default **off**) | ≈230 s, fixed | — | Idle-based: heartbeats keep it alive indefinitely. WS concurrency by SKU (Basic 350; Standard+ unlimited). ARR affinity irrelevant to WS; needed only for HTTP fallback. |
| App Service (Linux) | always on | ≈240 s, fixed | — | Disable `perMessageDeflate` in Node (platform guidance). |
| Container Apps | native (Envoy) | 240 s fixed; premium ingress 4→30 min | — | WS and gRPC mutually exclusive per app. Assume scale-in drops WS with only the 30 s SIGTERM grace. |
| AKS + ingress-nginx | works via upgrade | `proxy-read/send-timeout` **60 s default** → raise | — | If exposed through an Azure LB Service, the LB's 4-min TCP idle also applies (annotation raises to 100 min; silent drop unless TCP Reset enabled). |
| AKS + App Gateway (AGIC) | native | request timeout **20–30 s default** → max 24 h — applies to the whole WS session | ≤ request timeout | The classic "connects then dies in 30 s with code 1006" signature. 30 k WS per instance; health probes must be HTTP. |
| Front Door Std/Premium | GA (2025); **not** on Classic | 5 min, fixed | **4 h hard** | Disable caching on WS routes; SSE not supported at all (relevant to fallback choice); 3 000 concurrent per profile. |
| VM + Azure LB | L4 passthrough | TCP idle 4 min → 100 min | — | Silent drop by default — enable TCP Reset; heartbeats are the only detection. |

### AWS

| Platform | Enable WS | Idle | Lifetime | Notes |
|---|---|---|---|---|
| ALB | native | **60 s default** → 4 000 s | — (keep-alive attribute's applicability to upgraded WS unverified) | Any byte resets the idle timer — ping/pong suffices. Deregistration delay default 300 s; WS surviving past it are cut abruptly. Post-upgrade the connection is inherently sticky. |
| NLB | L4 | TCP 350 s → 60–6 000 s (TLS listeners fixed 350 s) | — | RST on expiry; also check target conntrack timeouts. |
| API Gateway (WebSocket APIs) | managed product | **10 min hard** | **2 h hard** | 32 KB frames / 128 KB messages. Poor fit for one multiplexed connection per client; prefer ALB. |
| CloudFront | supported (HTTP/1.1) | ~10 min (community-reported, not adjustable) | — | Forward `Sec-WebSocket-*` headers via origin request policy. |
| ECS / EKS behind ALB | via ALB | ALB rules | ALB rules | SIGTERM → `stopTimeout` 30 s (Fargate ≤ 120 s) → SIGKILL: send closes within the window. |
| App Runner | **no WS** | — | — | Service closed to new customers (2026); target ECS instead. |
| Elastic Beanstalk | ALB + nginx conf | instance nginx 60 s **and** ALB 60 s stack | — | Raise `proxy_read_timeout` via `.platform/nginx/conf.d/`. |

### GCP

| Platform | Enable WS | Idle | Lifetime | Notes |
|---|---|---|---|---|
| Cloud Run | native | request timeout governs | **request timeout: 5 min default → 60 min max** | An open WS is an active request: instance stays billed; counts toward concurrency (≤1000). Session affinity is best-effort only — keep the protocol stateless (it is: bookmarks). |
| GKE + GCLB (Ingress/Gateway) | native | backend service timeout **30 s default** → raise via `BackendConfig`/`GCPBackendPolicy` `timeoutSec` | global external ALB: **24 h hard** for active WS; classic ALB: backend timeout bounds the session | GFE restarts can cut connections anytime; `drainingTimeoutSec` default 0 (off) — set it. |
| App Engine standard | **no WS** | — | — | Use flexible or Cloud Run. |
| App Engine flexible | native | — | **1 h hard** | Optional `session_affinity` for fallback only. |

## 3. Operator checklist

Per environment, before enabling the WS transport:

1. **Raise the four commonly-forgotten knobs** (each defaults below the heartbeat
   headroom): ALB `idle_timeout` (60 s → ≥ 300 s), nginx `proxy_read_timeout` /
   `proxy_send_timeout` (60 s → ≥ 3600 s), Azure App Gateway request timeout
   (20–30 s → ≥ 3600 s), GCLB backend `timeoutSec` (30 s → ≥ 3600 s).
2. **Enable WS where it's a switch**: App Service Windows `webSocketsEnabled`;
   CloudFront header forwarding; Front Door: Std/Premium only, caching off.
3. **Align drain windows**: LB deregistration delay / `drainingTimeoutSec` ≥ the
   server's SIGTERM grace; verify the platform's grace (30 s typical) exceeds the
   time to send staggered `1012` closes.
4. **Platforms with hard lifetime caps** (Cloud Run, App Engine flex, API GW, Front
   Door): keep the connection lease at ≤ 50 min (default). Everywhere else the
   default is still safe; disabling is an optimization.
5. **Scale-out**: fact fan-out is in-process (`ObservableSource`), so replicas do
   not see each other's saves. Until a pub/sub backplane exists, route all writers
   and subscribers of a shared dataset to one replica (or run one replica). This is
   a pre-existing constraint of the HTTP streaming path, not new to WS — but WS's
   longer connections make it more visible. Bookmark resume keeps this safe: a
   missed notification is healed by the next resume, never lost.
6. **No sticky sessions needed for WS** (the TCP connection pins itself). The HTTP
   long-poll fallback is also stateless by design (bookmarks in every request), so
   affinity is not required there either — do not enable ARR affinity / cookie
   stickiness for Jinaga's sake.

## 4. Fallback triggers on real platforms

The §8 transport-selection rules map to concrete platform failures:

- **Handshake never succeeds** (no 101: Front Door Classic, App Runner, App Engine
  standard, corporate proxies stripping `Upgrade`): falls back after
  `wsFailureThreshold` attempts. This is the "WS is unavailable here" case.
- **Connects, then dies within seconds repeatedly** (unraised App Gateway 20–30 s or
  GCLB 30 s timeout — close code 1006 shortly after subscribe): also counts toward
  the pre-healthy failure threshold because the connection never survives to
  `stableSeconds`. The deployment fix is checklist item 1; the client meanwhile
  degrades gracefully instead of flapping.
- **Long-poll fallback holds must stay short (~30 s)** and be bounded server-side:
  on Azure App Service, client aborts of streaming HTTP responses are *not reliably
  propagated* to the app (documented in multiple Microsoft Q&A threads —
  `res.on('close')` may never fire), so the server must bound each hold with its own
  timer rather than trusting abort events. Note: the field report on issue #127
  observed the same non-propagation behind Azure Container Apps ingress
  (`Client disconnected: false` in production logs); public documentation of ACA's
  Envoy ingress suggests aborts *should* propagate, and no public issue corroborates
  the ACA attribution — treat ACA abort propagation as unverified either way and
  bound holds server-side regardless. WebSocket closes, by contrast, are explicit
  in-band frames and propagate reliably through every surveyed ingress; half-open
  TCP drops remain detectable only by heartbeat, which the protocol provides.

## 5. Parameter summary (spec defaults vs platform limits)

| Parameter | Default | Binding constraint |
|---|---|---|
| `pingIntervalSeconds` | 20 s | ≤ 75 % of the tightest *raised* idle timer; clears the ~230 s non-configurable Azure floors ~10× over |
| `pongTimeoutSeconds` | 30 s | server-side dead-peer bound; replaces the HTTP path's 5-minute timeout |
| `watchdogSeconds` (client) | 45 s | ≈ 2× ping + margin (SignalR's 2× rule) |
| `leaseSeconds` | 50 min ±10 % | Cloud Run 60 min / App Engine flex 1 h are the lowest hard caps |
| backoff | 0–500 ms first, then full jitter to 30 s cap | ALB/Front Door reconnect storms; IANA guidance for 1012 is a 5–30 s randomized delay |
| drain | staggered `1012` within grace | 30 s SIGTERM grace on ACA/K8s/ECS |
| fallback hold | ~30 s per long-poll | fits under every default request timer; App Service abort non-propagation |

## 6. Sources

Key vendor documents verified during research (July 2026): Azure App Service
configuration and troubleshooting (230 s idle), Azure Container Apps ingress and
lifecycle (240 s idle, 30 s grace, premium ingress timeouts), Application Gateway
WebSocket support and HTTP settings (request timeout applies to WS; 86 400 s max),
Front Door WebSocket GA notes (5 min idle, 4 h cap, no SSE), Azure Load Balancer TCP
reset/idle timeout; AWS ALB attributes (60 s idle, byte-based reset, deregistration
delay), NLB connection idle timeout (configurable since 2024), API Gateway WS quotas
(10 min / 2 h), CloudFront WebSocket behavior, ECS graceful shutdown; GCP Cloud Run
WebSockets and request timeout (60 min max), Cloud Load Balancing backend-service
timeouts (30 s default; 24 h active-WS cap on global external ALB), GKE
BackendConfig/GCPBackendPolicy, App Engine environment comparison and flexible WS
(1 h). Community-sourced (lower confidence, flagged above): CloudFront ~10 min WS
idle cap; ACA scale-to-zero behavior with open WS; ALB keep-alive applicability to
upgraded connections.
