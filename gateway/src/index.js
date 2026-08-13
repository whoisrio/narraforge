// NarraForge API gateway: api.<domain>/* -> https://<user>-<space>.hf.space/*
//
// Plain fetch reverse proxy:
// - forwards method / headers / body as-is (streaming in both directions),
// - injects X-Narraforge-Gateway-Secret (shared secret checked by the backend
//   AccessEnforcementMiddleware) and Authorization: Bearer <HF_TOKEN>
//   (required because the HF Space is private),
// - OPTIONS preflight is proxied through like any other request (the backend
//   CORSMiddleware answers it).
//
// env vars: UPSTREAM_ORIGIN ([vars] in wrangler.toml)
// secrets:   GATEWAY_SECRET, HF_TOKEN (wrangler secret put)

// Hop-by-hop headers must not be forwarded (RFC 7230 6.1); host/content-length
// are recomputed by fetch for the upstream connection.
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  // Client-supplied credentials are always replaced below.
  "authorization",
  "x-narraforge-gateway-secret",
]);

function buildUpstreamHeaders(request, env) {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower.startsWith("cf-")) continue;
    headers.set(name, value);
  }
  headers.set("X-Narraforge-Gateway-Secret", env.GATEWAY_SECRET);
  headers.set("Authorization", `Bearer ${env.HF_TOKEN}`);
  return headers;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const upstream = env.UPSTREAM_ORIGIN.replace(/\/+$/, "") + url.pathname + url.search;

    const hasBody = request.method !== "GET" && request.method !== "HEAD";
    const resp = await fetch(upstream, {
      method: request.method,
      headers: buildUpstreamHeaders(request, env),
      body: hasBody ? request.body : undefined,
      // Pass upstream redirects through untouched instead of following them.
      redirect: "manual",
    });

    // Pass the response through untouched (including Set-Cookie and streaming
    // bodies); fetch already strips hop-by-hop headers on the way out.
    return new Response(resp.body, resp);
  },
};
