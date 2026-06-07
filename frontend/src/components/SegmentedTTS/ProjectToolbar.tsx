import type { SegmentedProject } from '../../types';

interface ProjectToolbarProps {
  project: SegmentedProject;
  onRename: (name: string) => void;
  onLayoutToggle: () => void;
  onGenerateAll: () => void;
  onAnnotateAll: () => void;
  onExport: () => void;
}

export function ProjectToolbar({ project, onRename, onExport, onLayoutToggle }: ProjectToolbarProps) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
      <input
        value={project.name}
        onChange={(e) => onRename(e.target.value)}
        style={{
          fontSize: 18,
          fontWeight: 600,
          background: 'transparent',
          border: 'none',
          color: '#eee',
          outline: 'none',
          borderBottom: '1px solid #444',
        }}
      />
      <span style={{ color: '#888', fontSize: 12 }}>{project.segments.length} 段</span>
      <button
        onClick={onLayoutToggle}
        style={{
          marginLeft: 'auto',
          background: '#2a2a2a',
          border: '1px solid #444',
          color: '#ccc',
          padding: '6px 12px',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        {project.layout === 'vertical' ? '横/纵' : '纵/横'}
      </button>
      <button
        onClick={onExport}
        style={{
          background: '#2a2a2a',
          border: '1px solid #444',
          color: '#ccc',
          padding: '6px 12px',
          borderRadius: 4,
          cursor: 'pointer',
          fontSize: 12,
        }}
      >
        导出
      </button>
    </div>
  );
}
