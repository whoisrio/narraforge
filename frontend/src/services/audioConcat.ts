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

/** 拼接多个 AudioBuffer，升采样到 targetSampleRate，返回 Float32Array */
export function concatAudioBuffers(
  buffers: AudioBuffer[],
  targetSampleRate: number,
): Float32Array {
  let totalLen = 0;
  for (const b of buffers) {
    const factor = targetSampleRate / b.sampleRate;
    totalLen += Math.floor(b.length * factor);
  }

  const out = new Float32Array(totalLen);
  let offset = 0;

  for (const buf of buffers) {
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
    for (let i = 0; i < newLen; i++) {
      const srcIdx = i / factor;
      const lo = Math.floor(srcIdx);
      const hi = Math.min(lo + 1, mono.length - 1);
      const frac = srcIdx - lo;
      out[offset + i] = mono[lo] * (1 - frac) + mono[hi] * frac;
    }
    offset += newLen;
  }

  return out;
}
