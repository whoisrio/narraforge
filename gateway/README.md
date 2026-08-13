# narraforge-api-gateway

Cloudflare Worker 反向代理：`api.<域名>/*` → HF Space（Docker SDK，私有）。

```
浏览器 → api.<域名>（本 Worker，前面由 Cloudflare Access 保护）
           │ 注入 X-Narraforge-Gateway-Secret（与后端 GATEWAY_SECRET 一致）
           │      Authorization: Bearer <HF_TOKEN>（访问私有 Space）
           ▼
        https://<user>-<space>.hf.space
```

后端（workers 模式）校验两条凭证之一：Access 注入的邮箱头，或与
`GATEWAY_SECRET` 相等的 `X-Narraforge-Gateway-Secret` 头——Space 私有部署
下浏览器请求不经过 Access 边缘直达 Worker，邮箱头不存在，靠共享密钥兜底，
同时挡住 hf.space 直连绕过（直连缺少密钥头 → 401）。

## 部署步骤

前置：已装 Node.js；HF Space 已建好并验证 `/health`（见 `docs/RUNBOOK.md`
HF Spaces 章节）；域名 NS 已托管在 Cloudflare。

```bash
cd gateway

# 1. 登录 Cloudflare
npx wrangler login

# 2. 改 wrangler.toml 的 UPSTREAM_ORIGIN 为你的 Space 地址
#    https://<user>-<space>.hf.space

# 3. 设置 secrets（交互式粘贴值）
npx wrangler secret put GATEWAY_SECRET   # 与 HF Space 的 GATEWAY_SECRET 环境变量一致
npx wrangler secret put HF_TOKEN         # HF access token（read 权限即可）

# 4. 部署
npx wrangler deploy

# 5. 绑定路由：Dashboard → Workers → narraforge-api-gateway
#    → Settings → Domains & Routes → Add route：api.<域名>/*
#    （api.<域名> 需已有 DNS 记录；proxied CNAME 指到任意外部地址即可，
#     route 命中后请求由 Worker 接管，不会真的回源。）

# 6. 验证
curl -i https://api.<域名>/health          # 200（健康检查放行，无凭证也通）
curl -i https://api.<域名>/api/config/capabilities   # 经 Access 后 200；无 Access 登录态时 302/403（Access 拦截）
```

## 注意

- 免费档限制（子请求数 / CPU 时间）对本纯代理场景无压力，无需特殊处理。
- Worker 不写单测（纯配置/胶水代码）；改动后用 `node --check src/index.js`
  验证语法。
