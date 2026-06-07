import { useEffect, useRef, useState } from 'react';
import heroImage from '../assets/frontpage-2.png';
import styles from './Landing.module.css';

interface LandingProps {
  onNavigate: (tab: 'voice-clone' | 'tts-synthesis' | 'speech-to-text' | 'model-config' | 'segmented-tts') => void;
}

/**
 * 主页 — 编辑式排版，参考 Apple 产品页语言
 * 克制装饰，让内容和留白说话
 */
export default function Landing({ onNavigate }: LandingProps) {
  const [visible, setVisible] = useState(false);

  // Hero 区块在挂载后渐入
  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={styles.page}>
      {/* ── Hero ── */}
      <section className={`${styles.hero} ${visible ? styles.heroVisible : ''}`}>
        <div className={styles.heroImage}>
          <img src={heroImage} alt="" />
        </div>
        <div className={styles.waveform}>
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className={styles.waveformBar} style={{ animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
        <div className={styles.heroCopy}>
          <h1 className={styles.heroTitle}>
            Voice Studio
          </h1>
          <p className={styles.heroLead}>
            基于 Qwen CosyVoice · MiMo TTS · Edge-TTS · Faster-Whisper 模型，将音色设计、文字转语音、语音转字幕融为一体的 AI 音频工作站
          </p>
          <div className={styles.heroActions}>
            <button
              className={styles.btnPill}
              onClick={() => onNavigate('voice-clone')}
            >
              开始使用
            </button>
          </div>
        </div>
      </section>

      {/* ── Feature 1: Voice Design ── */}
      <FeatureTile
        number="01"
        title="音色设计"
        subtitle="Voice Design"
        body="上传一段 30 秒的音频样本，AI 即可精准复刻说话人的音色、语调与情感韵律。支持 CosyVoice 云端注册与 MiMo 即时复刻两种引擎，克隆后的声音可用于任意文本的语音合成。"
        action="体验音色设计"
        onAction={() => onNavigate('voice-clone')}
        theme="white"
      />

      {/* ── Feature 2: TTS ── */}
      <FeatureTile
        number="02"
        title="文字转语音"
        subtitle="Text to Speech"
        body="输入文字，即刻生成自然流畅的语音。支持 CosyVoice、MiMo TTS、Edge-TTS 三引擎切换，多语种、语速音调调节，满足播客、配音、无障碍朗读等多样化场景。"
        action="体验文字转语音"
        onAction={() => onNavigate('tts-synthesis')}
        theme="parchment"
      />

      {/* ── Feature 3: Speech to Text ── */}
      <FeatureTile
        number="03"
        title="语音转字幕"
        subtitle="Speech to Text"
        body="将音频或视频文件智能转写为高精度字幕，支持多说话人自动识别与时间轴对齐，大幅提升视频后期效率。"
        action="体验语音转字幕"
        onAction={() => onNavigate('speech-to-text')}
        theme="white"
      />

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <span>Voice Studio</span>
        <span>Powered by iamrio</span>
        <span>© 2026</span>
      </footer>
    </div>
  );
}

/** 单个功能瓷砖区块 */
function FeatureTile({
  number,
  title,
  subtitle,
  body,
  action,
  onAction,
  theme,
}: {
  number: string;
  title: string;
  subtitle: string;
  body: string;
  action: string;
  onAction: () => void;
  theme: 'white' | 'parchment';
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          obs.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <section
      ref={ref}
      className={`${styles.tile} ${styles[`tile${theme}`]} ${inView ? styles.tileVisible : ''}`}
    >
      <div className={styles.tileInner}>
        <span className={styles.tileNum}>{number}</span>
        <span className={styles.tileLabel}>{subtitle}</span>
        <h2 className={styles.tileTitle}>{title}</h2>
        <p className={styles.tileBody}>{body}</p>
        <button className={styles.btnPill} onClick={onAction}>
          {action}
        </button>
      </div>
    </section>
  );
}