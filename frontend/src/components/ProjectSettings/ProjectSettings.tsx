import type { SegmentedProject } from '../../types';
import styles from './ProjectSettings.module.css';

type ProjectSettingsMeta = Pick<SegmentedProject, 'description' | 'project_type' | 'default_language' | 'export_directory' | 'export_naming_template'>;

interface ProjectSettingsProps {
  projectName: string;
  remotionPath?: string | null;
  storageMode: string;
  chapterCount: number;
  projectDescription?: string | null;
  projectType?: string | null;
  defaultLanguage?: string | null;
  exportDirectory?: string | null;
  exportNamingTemplate?: string | null;
  onRenameProject: (name: string) => void;
  onUpdateRemotionPath: (path: string | null) => void;
  onUpdateProjectMeta: (meta: Partial<ProjectSettingsMeta>) => void;
  onBackToOverview: () => void;
}

export function ProjectSettings({
  projectName,
  remotionPath,
  storageMode,
  chapterCount,
  projectDescription,
  projectType,
  defaultLanguage,
  exportDirectory,
  exportNamingTemplate,
  onRenameProject,
  onUpdateRemotionPath,
  onUpdateProjectMeta,
  onBackToOverview,
}: ProjectSettingsProps) {
  return (
    <section className={styles.root}>
      <header className={styles.header}>
        <div>
          <span className={styles.kicker}>Project Settings</span>
          <h2>项目设置</h2>
          <p>管理项目元信息、Remotion 导出目标和默认生产约定。</p>
        </div>
        <button type="button" onClick={onBackToOverview}>返回总览</button>
      </header>

      <div className={styles.grid}>
        <section className={styles.card}>
          <span className={styles.kicker}>Metadata</span>
          <label className={styles.field}>
            <span>项目名称</span>
            <input aria-label="项目名称" value={projectName} onChange={(event) => onRenameProject(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span>项目描述</span>
            <textarea
              aria-label="项目描述"
              value={projectDescription ?? ''}
              placeholder="这个项目的内容方向、发布平台或制作备注"
              onChange={(event) => onUpdateProjectMeta({ description: event.target.value || null })}
            />
          </label>
          <div className={styles.twoColFields}>
            <label className={styles.field}>
              <span>项目类型</span>
              <select
                aria-label="项目类型"
                value={projectType ?? 'explainer'}
                onChange={(event) => onUpdateProjectMeta({ project_type: event.target.value })}
              >
                <option value="explainer">解说 / Explainer</option>
                <option value="audiobook">有声书 / Audiobook</option>
                <option value="course">课程 / Course</option>
                <option value="podcast">播客 / Podcast</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>默认语言</span>
              <select
                aria-label="默认语言"
                value={defaultLanguage ?? 'zh-CN'}
                onChange={(event) => onUpdateProjectMeta({ default_language: event.target.value })}
              >
                <option value="zh-CN">中文（zh-CN）</option>
                <option value="en-US">English (en-US)</option>
                <option value="ja-JP">日本語（ja-JP）</option>
              </select>
            </label>
          </div>
          <div className={styles.metaList}>
            <div><span>章节数量</span><strong>{chapterCount} 章</strong></div>
            <div><span>存储模式</span><strong>{storageMode}</strong></div>
          </div>
        </section>

        <section className={styles.card}>
          <span className={styles.kicker}>Remotion / Export</span>
          <label className={styles.field}>
            <span>Remotion 项目路径</span>
            <input
              aria-label="Remotion 项目路径"
              value={remotionPath ?? ''}
              placeholder="/path/to/remotion-project"
              onChange={(event) => onUpdateRemotionPath(event.target.value || null)}
            />
          </label>
          <label className={styles.field}>
            <span>默认导出目录</span>
            <input
              aria-label="默认导出目录"
              value={exportDirectory ?? 'public/audio'}
              placeholder="public/audio"
              onChange={(event) => onUpdateProjectMeta({ export_directory: event.target.value || null })}
            />
          </label>
          <label className={styles.field}>
            <span>导出命名模板</span>
            <input
              aria-label="导出命名模板"
              value={exportNamingTemplate ?? '{project}-{chapter}-{date}'}
              placeholder="{project}-{chapter}-{date}"
              onChange={(event) => onUpdateProjectMeta({ export_naming_template: event.target.value || null })}
            />
          </label>
          <div className={styles.exportRule}>
            <strong>Studio 导出</strong>
            <p>导出动作保留在工作室；设置页保存默认路径与命名约定。音频优先写入 Remotion 项目的 public/audio，未设置时使用上方默认导出目录。</p>
          </div>
        </section>

        <section className={styles.card}>
          <span className={styles.kicker}>Defaults</span>
          <div className={styles.metaList}>
            <div><span>默认导出命名</span><strong>{exportNamingTemplate || '{project}-{chapter}-{date}'}</strong></div>
            <div><span>默认导出目录</span><strong>{exportDirectory || 'public/audio'}</strong></div>
            <div><span>项目语言</span><strong>{defaultLanguage || 'zh-CN'}</strong></div>
          </div>
        </section>
      </div>
    </section>
  );
}
