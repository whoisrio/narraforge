import { useTranscription } from '../hooks/useTranscription';
import {
  AudioDropzone,
  TranscriptEditor,
  CorrectionPanel,
  SidebarConfig,
  ExportPanel,
  BilingualCard,
  QualityReport,
  PlaybackBar,
  TranscriptionHistory,
} from '../components/SpeechToText';
import styles from './SpeechToText.module.css';

export function SpeechToText() {
  const tx = useTranscription();

  return (
    <div className={styles.container}>
      {/* Section header */}
      <div className={styles.pageHeader}>
        <div>
          <h2 className={styles.pageTitle}>Transcription Hub</h2>
          <p className={styles.pageDesc}>Convert spoken narrative into polished prose.</p>
        </div>
      </div>

      {/* Two-column layout */}
      <div className={styles.layout}>
        {/* Main content */}
        <div className={styles.main}>
          <AudioDropzone
            files={tx.files}
            onReplace={tx.replaceFiles}
            onAdd={tx.addFiles}
            onRemove={tx.removeFile}
            onMove={tx.moveFile}
            onTranscribe={tx.handleTranscribe}
            processing={tx.processing}
          />

          <TranscriptEditor
            result={tx.result}
            processing={tx.processing}
            error={tx.error}
            onContentChange={(content) => tx.setResult(tx.result ? { ...tx.result, content } : null)}
          />

          <CorrectionPanel
            suggestions={tx.suggestions}
            acceptedSuggestions={tx.acceptedSuggestions}
            correctionModel={tx.correctionModel}
            correcting={tx.correcting}
            originalDoc={tx.originalDoc}
            correctionMode={tx.correctionMode}
            onOriginalDocChange={tx.setOriginalDoc}
            onModeChange={tx.setCorrectionMode}
            onCorrect={tx.handleCorrect}
            onToggleAccept={tx.toggleAcceptSuggestion}
            onApply={tx.applyCorrections}
          />

          {/* History section */}
          <div className={styles.historySection}>
            <TranscriptionHistory records={tx.history} onDelete={tx.handleDeleteRecord} />
          </div>
        </div>

        {/* Sidebar */}
        <aside className={styles.sidebar}>
          <SidebarConfig
            engine={tx.engine}
            modelSize={tx.modelSize}
            beamSize={tx.beamSize}
            enableVad={tx.enableVad}
            engineOptions={tx.engineOptions}
            whisperModelOptions={tx.whisperModelOptions}
            funasrModelOptions={tx.funasrModelOptions}
            onEngineChange={tx.handleEngineChange}
            onModelSizeChange={tx.setModelSize}
            onBeamSizeChange={tx.setBeamSize}
            onEnableVadChange={tx.setEnableVad}
          />

          <QualityReport result={tx.result} />

          <ExportPanel
            hasResult={!!tx.result}
            onDownloadSrt={tx.handleDownload}
            onExport={tx.exportSubtitle}
          />

          <BilingualCard
            bilingualSegments={tx.bilingualSegments}
            bilingualSrt={tx.bilingualSrt}
            translating={tx.translating}
            targetLang={tx.targetLang}
            hasResult={!!tx.result}
            onTargetLangChange={tx.setTargetLang}
            onTranslate={tx.handleTranslate}
            onDownload={tx.handleDownloadBilingual}
          />
        </aside>
      </div>

      {/* Floating playback bar */}
      <PlaybackBar audioUrl={tx.audioUrl} />
    </div>
  );
}
