/**
 * 音频静音裁剪工具
 * 生成后自动裁剪首尾多余静音，段落间只保留一处自然停顿
 */

/** 裁剪参数 */
export interface TrimOptions {
  /** 静音阈值振幅，低于此视为静音（默认 0.003 ≈ -50dB，避免裁掉弱起声） */
  threshold?: number;
  /** 兼容旧调用：首尾都保留的静音时长（ms） */
  keepMs?: number;
  /** 开头保留的静音时长（ms）；未设置时使用 keepMs */
  leadingKeepMs?: number;
  /** 结尾保留的静音时长（ms）；未设置时使用 keepMs */
  trailingKeepMs?: number;
}

/**
 * 裁剪 AudioBuffer 首尾静音
 * 返回裁剪后的 AudioBuffer
 */
export function trimAudioBufferSilence(
  buffer: AudioBuffer,
  options: TrimOptions = {},
): AudioBuffer {
  const { threshold = 0.003, keepMs = 80 } = options;
  const leadingKeepMs = options.leadingKeepMs ?? keepMs;
  const trailingKeepMs = options.trailingKeepMs ?? keepMs;
  const ctx = new OfflineAudioContext(1, 1, buffer.sampleRate);
  const sr = buffer.sampleRate;
  const leadingKeepSamples = Math.floor(sr * leadingKeepMs / 1000);
  const trailingKeepSamples = Math.floor(sr * trailingKeepMs / 1000);

  // 取 mono
  const raw = buffer.numberOfChannels > 1
    ? mixToMono(buffer)
    : buffer.getChannelData(0);

  // 找开头静音结束位置
  let leadEnd = 0;
  for (let i = 0; i < raw.length; i++) {
    if (Math.abs(raw[i]) > threshold) { leadEnd = i; break; }
  }

  // 找结尾静音开始位置
  let trailStart = raw.length;
  for (let i = raw.length - 1; i >= 0; i--) {
    if (Math.abs(raw[i]) > threshold) { trailStart = i + 1; break; }
  }

  // 分别保留开头/结尾的自然停顿
  const trimStart = Math.max(0, leadEnd - leadingKeepSamples);
  const trimEnd = Math.min(raw.length, trailStart + trailingKeepSamples);

  if (trimStart === 0 && trimEnd === raw.length) return buffer; // 无需裁剪

  // 创建裁剪后的 buffer
  const newLen = trimEnd - trimStart;
  const newBuffer = ctx.createBuffer(buffer.numberOfChannels, newLen, sr);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = newBuffer.getChannelData(ch);
    for (let i = 0; i < newLen; i++) {
      dst[i] = src[trimStart + i];
    }
  }
  return newBuffer;
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const len = buffer.length;
  const mono = new Float32Array(len);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < len; i++) mono[i] += data[i];
  }
  for (let i = 0; i < len; i++) mono[i] /= buffer.numberOfChannels;
  return mono;
}

/**
 * 裁剪 base64 音频的首尾静音，返回新的 base64
 * 用于生成后自动处理
 */
export async function trimBase64AudioSilence(
  base64: string,
  options: TrimOptions = {},
): Promise<{ base64: string; trimmedMs: number }> {
  const byteStr = atob(base64);
  const bytes = new Uint8Array(byteStr.length);
  for (let i = 0; i < byteStr.length; i++) bytes[i] = byteStr.charCodeAt(i);

  const ac = new AudioContext();
  const buffer = await ac.decodeAudioData(bytes.buffer);
  const originalDuration = buffer.duration;

  const trimmed = trimAudioBufferSilence(buffer, options);
  const trimmedDuration = trimmed.duration;
  const trimmedMs = Math.round((originalDuration - trimmedDuration) * 1000);

  // 重新编码为 WAV
  const offline = new OfflineAudioContext(trimmed.numberOfChannels, trimmed.length, trimmed.sampleRate);
  const source = offline.createBufferSource();
  source.buffer = trimmed;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  // Float32 → WAV base64
  const wavBlob = audioBufferToWavBlob(rendered);
  const reader = new FileReader();
  const newBase64 = await new Promise<string>((resolve) => {
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.readAsDataURL(wavBlob);
  });

  ac.close();
  return { base64: newBase64, trimmedMs };
}

function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const bufferSize = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferSize);
  const view = new DataView(arrayBuffer);

  function writeStr(off: number, s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  }

  writeStr(0, 'RIFF');
  view.setUint32(4, bufferSize - 8, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) channels.push(buffer.getChannelData(ch));

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const s = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
