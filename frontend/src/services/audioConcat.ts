export function fmtSrtTime(ms: number): string {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const ms3 = String(Math.floor(ms % 1000)).padStart(3, '0');
  return `${h}:${m}:${s},${ms3}`;
}

interface SrtSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export function buildSRTContent(segments: SrtSegment[]): string {
  return segments.map((seg, i) => {
    const start = fmtSrtTime(seg.startMs);
    const end = fmtSrtTime(seg.endMs);
    return `${i + 1}\n${start} --> ${end}\n${seg.text}\n`;
  }).join('\n');
}

/** WAV 文件头写法和 PCM 16-bit 编码 */
export function encodeWAV(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset: number, str: string) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * 检测音频开头/结尾的静音长度（采样数）
 * threshold: 低于此振幅视为静音（默认 0.01 ≈ -40dB）
 * keepSamples: 保留的静音采样数，裁剪后至少留这么多
 */
function detectSilenceBoundary(
  samples: Float32Array,
  fromEnd: boolean,
  threshold: number = 0.01,
  keepSamples: number = 0,
): number {
  let silenceEnd = 0;

  if (fromEnd) {
    // 从尾部往前扫
    for (let i = samples.length - 1; i >= 0; i--) {
      if (Math.abs(samples[i]) > threshold) break;
      silenceEnd = samples.length - i;
    }
  } else {
    // 从头部往后扫
    for (let i = 0; i < samples.length; i++) {
      if (Math.abs(samples[i]) > threshold) break;
      silenceEnd = i + 1;
    }
  }

  // 裁剪后保留 keepSamples 个采样的静音
  // 实际裁剪数 = 检测到的静音 - 保留数
  return Math.max(0, silenceEnd - keepSamples);
}

/**
 * 裁剪单个 AudioBuffer 的首尾静音，返回裁剪后的 Float32Array
 */
function trimBufferSilence(
  buf: AudioBuffer,
  targetSampleRate: number,
  threshold: number = 0.01,
  keepMs: number = 80,
): { samples: Float32Array; trimmedStart: number; trimmedEnd: number } {
  // 先转 mono + 重采样
  const factor = targetSampleRate / buf.sampleRate;
  const channels = buf.numberOfChannels;
  const mono = channels > 1
    ? new Float32Array(buf.length).map((_, i) => {
        let sum = 0;
        for (let ch = 0; ch < channels; ch++) sum += buf.getChannelData(ch)[i];
        return sum / channels;
      })
    : buf.getChannelData(0);

  const newLen = Math.floor(mono.length * factor);
  const resampled = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcIdx = i / factor;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, mono.length - 1);
    const frac = srcIdx - lo;
    resampled[i] = mono[lo] * (1 - frac) + mono[hi] * frac;
  }

  const keepSamples = Math.floor(targetSampleRate * keepMs / 1000);
  const leadSamples = detectSilenceBoundary(resampled, false, threshold, keepSamples);
  const trailSamples = detectSilenceBoundary(resampled, true, threshold, keepSamples);

  const trimmed = resampled.slice(leadSamples, resampled.length - trailSamples);
  return { samples: trimmed, trimmedStart: leadSamples, trimmedEnd: trailSamples };
}

/** 拼接参数 */
export interface ConcatOptions {
  /** 是否裁剪首尾静音（默认 true） */
  trimSilence?: boolean;
  /** 静音阈值振幅（默认 0.01 ≈ -40dB） */
  silenceThreshold?: number;
  /** 首尾保留的停顿时长（ms，默认 80） */
  keepMs?: number;
  /** 段落间额外插入的静音时长（ms，默认 0，不额外加停顿） */
  gapMs?: number;
}

/**
 * 拼接多个 AudioBuffer：
 * 1. 裁剪每段首尾静音（首段保留更多，后续段落更激进）
 * 2. 默认不额外插入段间静音，只保留裁剪后的自然边缘
 * 3. 升采样到 targetSampleRate
 */
export function concatAudioBuffers(
  buffers: AudioBuffer[],
  targetSampleRate: number,
  options: ConcatOptions = {},
): Float32Array {
  const {
    trimSilence = true,
    silenceThreshold = 0.01,
    keepMs = 80,
    gapMs = 0,
  } = options;

  const gapSamples = Math.floor(targetSampleRate * gapMs / 1000);
  const silencePad = new Float32Array(gapSamples); // 全零 = 静音间隔

  // 处理每段音频
  const processed: Float32Array[] = [];
  for (let i = 0; i < buffers.length; i++) {
    if (trimSilence) {
      // Same keep for every segment; generation-time trim is the primary path.
      const { samples } = trimBufferSilence(buffers[i], targetSampleRate, silenceThreshold, keepMs);
      processed.push(samples);
    } else {
      // 不裁剪，只做重采样
      const buf = buffers[i];
      const factor = targetSampleRate / buf.sampleRate;
      const channels = buf.numberOfChannels;
      const mono = channels > 1
        ? new Float32Array(buf.length).map((_, j) => {
            let sum = 0;
            for (let ch = 0; ch < channels; ch++) sum += buf.getChannelData(ch)[j];
            return sum / channels;
          })
        : buf.getChannelData(0);
      const newLen = Math.floor(mono.length * factor);
      const resampled = new Float32Array(newLen);
      for (let j = 0; j < newLen; j++) {
        const srcIdx = j / factor;
        const lo = Math.floor(srcIdx);
        const hi = Math.min(lo + 1, mono.length - 1);
        const frac = srcIdx - lo;
        resampled[j] = mono[lo] * (1 - frac) + mono[hi] * frac;
      }
      processed.push(resampled);
    }
  }

  // 计算总长度
  let totalLen = 0;
  for (let i = 0; i < processed.length; i++) {
    totalLen += processed[i].length;
    if (i < processed.length - 1) totalLen += gapSamples; // 段间间隔
  }

  // 拼接
  const out = new Float32Array(totalLen);
  let offset = 0;
  for (let i = 0; i < processed.length; i++) {
    out.set(processed[i], offset);
    offset += processed[i].length;
    if (i < processed.length - 1) {
      out.set(silencePad, offset);
      offset += gapSamples;
    }
  }

  return out;
}
