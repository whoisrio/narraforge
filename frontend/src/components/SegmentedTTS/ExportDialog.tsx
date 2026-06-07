import type { Segment } from '../../types';

interface ExportDialogProps {
  open: boolean;
  segments: Segment[];
  defaultName: string;
  onClose: () => void;
}

export function ExportDialog({ open, onClose }: ExportDialogProps) {
  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1f1f1f',
          padding: 24,
          borderRadius: 10,
          minWidth: 300,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ color: '#eee', margin: '0 0 16px' }}>导出选项</h3>
        <p style={{ color: '#888' }}>（导出功能将在后续任务中实现）</p>
        <button
          onClick={onClose}
          style={{
            marginTop: 16,
            background: '#333',
            border: '1px solid #555',
            color: '#ccc',
            padding: '6px 14px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          关闭
        </button>
      </div>
    </div>
  );
}
