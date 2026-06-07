import { useEffect, useRef, useState } from 'react';
import heroImage from '../assets/frontpage-2.png';
import styles from './Landing.module.css';

interface LandingProps {
  onNavigate: (tab: 'voice-clone' | 'tts-synthesis' | 'speech-to-text' | 'model-config') => void;
}

export default function Landing({ onNavigate }: LandingProps) {
  const [heroVisible, setHeroVisible] = useState(false);

  useEffect(() => {
    const id = requestAnimationFrame(() => setHeroVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className={styles.page}>
      {/* ── Hero ── */}
      <section className={`${styles.hero} ${heroVisible ? styles.heroVisible : ''}`}>
        <div className={styles.heroImage}>
          <img src={heroImage} alt="" />
        </div>
        <div className={styles.waveform}>
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} className={styles.waveformBar} style={{ animationDelay: `${i * 0.1}s` }} />
          ))}
        </div>
        <div className={styles.heroCopy}>
          <h1 className={styles.heroTitle}>Voice Studio</h1>
          <p className={styles.heroLead}>
            基于 Qwen CosyVoice · MiMo TTS · Edge-TTS · Faster-Whisper 模型，将音色设计、文字转语音、语音转字幕融为一体的 AI 音频工作站
          </p>
          <div className={styles.heroActions}>
            <button className={styles.btnPill} onClick={() => onNavigate('voice-clone')}>
              开始使用
            </button>
          </div>
        </div>
      </section>

      {/* ── Feature Cards ── */}
      <section className={styles.featuresSection}>
        <div className={styles.featuresGrid}>
          <FeatureCard
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" x2="12" y1="19" y2="22"/>
              </svg>
            }
            label="Voice Design"
            title="音色设计"
            body="上传一段 30 秒的音频样本，AI 即可精准复刻说话人的音色、语调与情感韵律。支持 CosyVoice 与 MiMo 双引擎。"
            action="体验音色设计"
            onAction={() => onNavigate('voice-clone')}
          />
          <FeatureCard
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15V6"/>
                <path d="M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"/>
                <path d="M12 12H3"/>
                <path d="M16 6H3"/>
                <path d="M12 18H3"/>
              </svg>
            }
            label="Text to Speech"
            title="文字转语音"
            body="输入文字，即刻生成自然流畅的语音。三引擎切换，多语种支持，满足播客、配音等多样化场景。"
            action="体验文字转语音"
            onAction={() => onNavigate('tts-synthesis')}
          />
          <FeatureCard
            icon={
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 7V4h16v3"/>
                <path d="M9 20h6"/>
                <path d="M12 4v16"/>
              </svg>
            }
            label="Speech to Text"
            title="语音转字幕"
            body="将音频或视频智能转写为高精度字幕，支持多说话人识别与时间轴对齐，大幅提升后期效率。"
            action="体验语音转字幕"
            onAction={() => onNavigate('speech-to-text')}
          />
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className={styles.footer}>
        <span className={styles.footerBrand}>Voice Studio</span>
        <span>Powered by iamrio</span>
        <span>© 2026</span>
      </footer>
    </div>
  );
}

/** 单个功能卡片 */
function FeatureCard({
  icon,
  label,
  title,
  body,
  action,
  onAction,
}: {
  icon: React.ReactNode;
  label: string;
  title: string;
  body: string;
  action: string;
  onAction: () => void;
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
    <div
      ref={ref}
      className={`${styles.featureCard} ${inView ? styles.featureCardVisible : ''}`}
      onClick={onAction}
    >
      <div className={styles.featureIcon}>{icon}</div>
      <span className={styles.featureLabel}>{label}</span>
      <h2 className={styles.featureTitle}>{title}</h2>
      <p className={styles.featureBody}>{body}</p>
      <button className={styles.btnPillSecondary} onClick={(e) => { e.stopPropagation(); onAction(); }}>
        {action}
      </button>
    </div>
  );
}
