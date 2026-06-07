import type { Segment, SegmentEngineParams } from '../../types';

interface SegmentEditDrawerProps {
  segment: Segment | null;
  onClose: () => void;
  onUpdateText: (id: string, text: string) => void;
  onUpdateSSML: (id: string, ssml: string) => void;
  onUpdateParams: (id: string, params: Partial<SegmentEngineParams>) => void;
  onRegenerate: (id: string) => void;
  onAnnotateSSML: (id: string) => void;
}

export function SegmentEditDrawer({ segment }: SegmentEditDrawerProps) {
  if (!segment) return null;
  return <div style={{ padding: 16, border: '1px solid #333' }}>Editing: {segment.text}</div>;
}
