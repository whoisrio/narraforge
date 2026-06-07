import type { Segment } from '../../types';

interface SegmentListProps {
  segments: Segment[];
  layout: string;
  selectedId?: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onInsertAfter: (id: string) => void;
  onAppend: () => void;
  onReorder: (from: number, to: number) => void;
  onEdit: (id: string) => void;
  onRegenerate: (id: string) => void;
  onUndo: (id: string) => void;
}

export function SegmentList({ segments }: SegmentListProps) {
  return <div>{segments.map(s => <div key={s.id}>{s.text}</div>)}</div>;
}
