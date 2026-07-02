import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n';
import styles from './Landing.module.css';

interface LandingProps {
  onNavigate: (tab: 'voice-clone' | 'tts-synthesis' | 'speech-to-text' | 'model-config') => void;
}

/* ── Segmented Circle Logo ── */
function SegmentedCircleLogo() {
  return (
    <div className={styles.logoWrapper}>
      <svg width="320" height="320" viewBox="0 0 320 320" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="lg1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#d4944e" />
            <stop offset="1" stopColor="#8b4c0d" />
          </linearGradient>
          <linearGradient id="lg2" x1="1" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#c47a3a" />
            <stop offset="1" stopColor="#d4944e" />
          </linearGradient>
        </defs>
        <g transform="translate(160 160)">
          <path d="M0 -128 A128 128 0 0 1 109.8 -65" stroke="url(#lg1)" strokeWidth="35" strokeLinecap="round" />
          <path d="M120 -31 A128 128 0 0 1 90.6 90.6" stroke="url(#lg2)" strokeWidth="35" strokeLinecap="round" opacity="0.88" />
          <path d="M65 109.8 A128 128 0 0 1 -65 109.8" stroke="url(#lg1)" strokeWidth="35" strokeLinecap="round" opacity="0.72" />
          <path d="M-90.6 90.6 A128 128 0 0 1 -120 -31" stroke="url(#lg2)" strokeWidth="35" strokeLinecap="round" opacity="0.55" />
          <path d="M-109.8 -65 A128 128 0 0 1 0 -128" stroke="url(#lg1)" strokeWidth="35" strokeLinecap="round" opacity="0.38" />
          <circle cx="0" cy="0" r="22" fill="#8b4c0d" />
          <circle cx="0" cy="0" r="9" fill="#fff8f1" />
        </g>
      </svg>
      <div className={styles.logoRing} />
      <div className={styles.logoGlow} />
      <span className={styles.logoDot1} />
      <span className={styles.logoDot2} />
      <span className={styles.logoDot3} />
    </div>
  );
}

/* ── Feature Card ── */
function FeatureCard({ iconGrad, title, desc }: { iconGrad: string; title: string; desc: string }) {
  return (
    <div className={styles.featureCard}>
      <div className={styles.featureIcon} style={{ background: iconGrad }} />
      <h3 className={styles.featureTitle}>{title}</h3>
      <p className={styles.featureDesc}>{desc}</p>
    </div>
  );
}

/* ── Workflow Step ── */
function WorkflowStep({ num, title, desc }: { num: string; title: string; desc: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setInView(true); obs.disconnect(); } },
      { threshold: 0.3 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className={`${styles.wfStep} ${inView ? styles.wfStepIn : ''}`}>
      <span className={styles.wfNum}>{num}</span>
      <h3 className={styles.wfTitle}>{title}</h3>
      <p className={styles.wfDesc}>{desc}</p>
    </div>
  );
}

/* ── Future Card ── */
function FutureCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className={styles.futureCard}>
      <h3 className={styles.futureTitle}>{title}</h3>
      <p className={styles.futureDesc}>{desc}</p>
    </div>
  );
}

/* ── Main Component ── */
export default function Landing({ onNavigate }: LandingProps) {
  const [heroIn, setHeroIn] = useState(false);
  const { t } = useTranslation();
  const flowRef = useRef<HTMLDivElement>(null);

  const scrollToFlow = () => {
    flowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  useEffect(() => {
    requestAnimationFrame(() => setHeroIn(true));
  }, []);

  return (
    <div className={styles.page}>
      {/* ════════════════ Hero ════════════════ */}
      <section className={`${styles.hero} ${heroIn ? styles.heroIn : ''}`}>
        <div className={styles.heroLeft}>
          <span className={styles.heroKicker}>{t('landing.heroKicker')}</span>
          <h1 className={styles.heroTitle}>{t('landing.heroTitle')}</h1>
          <p className={styles.heroSub}>{t('landing.heroSubtitle')}</p>
          <p className={styles.heroDesc}>{t('landing.heroDesc')}</p>
          <div className={styles.heroActions}>
            <button className={styles.btnPrimary} onClick={() => onNavigate('voice-clone')}>
              {t('landing.heroCTA')}
            </button>
            <button className={styles.btnSecondary} onClick={scrollToFlow}>
              {t('landing.heroSecondary')}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </div>
        </div>
        <div className={styles.heroRight}>
          <SegmentedCircleLogo />
        </div>
      </section>

      {/* ════════════ Features ════════════ */}
      <section className={styles.featuresSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>{t('landing.features.label')}</span>
          <h2 className={styles.sectionTitle}>{t('landing.features.title')}</h2>
        </div>
        <div className={styles.featuresGrid}>
          <FeatureCard iconGrad="linear-gradient(135deg, #c47a3a, #8b4c0d)" title={t('landing.features.card1.title')} desc={t('landing.features.card1.desc')} />
          <FeatureCard iconGrad="linear-gradient(135deg, #d4944e, #c47a3a)" title={t('landing.features.card2.title')} desc={t('landing.features.card2.desc')} />
          <FeatureCard iconGrad="linear-gradient(135deg, #8b4c0d, #c47a3a)" title={t('landing.features.card3.title')} desc={t('landing.features.card3.desc')} />
          <FeatureCard iconGrad="linear-gradient(135deg, #ffdcc3, #d4944e)" title={t('landing.features.card4.title')} desc={t('landing.features.card4.desc')} />
        </div>
      </section>

      {/* ════════════ Workflow ════════════ */}
      <section ref={flowRef} className={styles.workflowSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>{t('landing.workflow.label')}</span>
          <h2 className={styles.sectionTitle}>{t('landing.workflow.title')}</h2>
        </div>
        <div className={styles.workflowTrack}>
          <WorkflowStep num="01" title={t('landing.workflow.step1.title')} desc={t('landing.workflow.step1.desc')} />
          <WorkflowStep num="02" title={t('landing.workflow.step2.title')} desc={t('landing.workflow.step2.desc')} />
          <WorkflowStep num="03" title={t('landing.workflow.step3.title')} desc={t('landing.workflow.step3.desc')} />
          <WorkflowStep num="04" title={t('landing.workflow.step4.title')} desc={t('landing.workflow.step4.desc')} />
        </div>
      </section>

      {/* ════════════ Future ════════════ */}
      <section className={styles.futureSection}>
        <div className={styles.sectionHeader}>
          <span className={styles.sectionLabel}>{t('landing.future.label')}</span>
          <h2 className={styles.sectionTitle}>{t('landing.future.title')}</h2>
        </div>
        <div className={styles.futureGrid}>
          <FutureCard title={t('landing.future.card1.title')} desc={t('landing.future.card1.desc')} />
          <FutureCard title={t('landing.future.card2.title')} desc={t('landing.future.card2.desc')} />
          <FutureCard title={t('landing.future.card3.title')} desc={t('landing.future.card3.desc')} />
        </div>
      </section>

      {/* ════════════ CTA ════════════ */}
      <section className={styles.ctaSection}>
        <h2 className={styles.ctaTitle}>{t('landing.cta.title')}</h2>
        <p className={styles.ctaSub}>{t('landing.cta.subtitle')}</p>
        <button className={styles.btnPrimary} onClick={() => onNavigate('voice-clone')}>
          {t('landing.cta.button')}
        </button>
      </section>

      {/* ════════════ Footer ════════════ */}
      <footer className={styles.footer}>
        <span className={styles.footerBrand}>{t('landing.footer.brand')}</span>
        <span className={styles.footerCopy}>{t('landing.footer.copy')}</span>
      </footer>
    </div>
  );
}
