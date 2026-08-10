// Protocol validation for the hand-rolled edge-tts client, using Node's
// built-in WebSocket (Node >= 21). Mirrors src/edge_tts_ws.py exactly.
import crypto from "node:crypto";

const TRUSTED = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const BASE = "speech.platform.bing.com/consumer/speech/synthesize/readaloud";
const WSS = `wss://${BASE}/edge/v1?TrustedClientToken=${TRUSTED}`;
const GEC_VERSION = "1-143.0.3650.75";
const WIN_EPOCH = 11644473600;

function secMsGec() {
  let ticks = Date.now() / 1000 + WIN_EPOCH;
  ticks -= ticks % 300;
  ticks *= 1e7;
  const s = `${Math.trunc(ticks)}${TRUSTED}`;
  return crypto.createHash("sha256").update(s, "ascii").digest("hex").toUpperCase();
}
const connId = () => crypto.randomUUID().replaceAll("-", "");
const dateStr = () => {
  const d = new Date().toUTCString(); // "Mon, 10 Aug 2026 01:00:00 GMT"
  // edge-tts wants "Mon Aug 10 2026 01:00:00 GMT+0000 (Coordinated Universal Time)"
  const [wd, rest] = d.split(", ");
  const [day, mon, year, time] = rest.split(" ");
  return `${wd} ${mon} ${day} ${year} ${time} GMT+0000 (Coordinated Universal Time)`;
};

const url = `${WSS}&ConnectionId=${connId()}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${GEC_VERSION}`;
const ws = new WebSocket(url);
ws.binaryType = "arraybuffer";
const audio = [];
const t0 = Date.now();

ws.onopen = () => {
  console.log(`[${Date.now() - t0}ms] open`);
  ws.send(
    `X-Timestamp:${dateStr()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
      '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n'
  );
  const ssml =
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    "<voice name='zh-CN-XiaoxiaoNeural'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>" +
    "你好,这是 Node 侧的 edge-tts 协议验证。" +
    "</prosody></voice></speak>";
  ws.send(
    `X-RequestId:${connId()}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${dateStr()}Z\r\nPath:ssml\r\n\r\n${ssml}`
  );
  console.log(`[${Date.now() - t0}ms] config+ssml sent`);
};
ws.onmessage = (ev) => {
  if (typeof ev.data === "string") {
    const head = ev.data.split("\r\n\r\n")[0];
    const path = (head.match(/Path:(.+)/) || [])[1];
    console.log(`[${Date.now() - t0}ms] text Path:${path}`);
    if (path === "turn.end") {
      const buf = Buffer.concat(audio);
      console.log(`DONE: ${buf.length} bytes, head=${buf.subarray(0, 8).toString("hex")}`);
      const isMp3 = buf.subarray(0, 3).toString() === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0);
      console.log("is_mp3:", isMp3);
      ws.close();
      process.exit(isMp3 ? 0 : 1);
    }
  } else {
    const buf = Buffer.from(ev.data);
    const hlen = buf.readUInt16BE(0);
    const headers = buf.subarray(0, hlen).toString();
    if (headers.includes("Path:audio")) {
      const data = buf.subarray(hlen + 2);
      if (data.length) audio.push(data);
    }
  }
};
ws.onerror = (e) => { console.log("ws error:", e.message || e); };
ws.onclose = (e) => { console.log(`ws close code=${e.code} reason=${e.reason}`); process.exit(2); };
setTimeout(() => { console.log("TIMEOUT"); process.exit(3); }, 45000);
