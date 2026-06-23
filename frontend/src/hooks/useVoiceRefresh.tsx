import { useContext } from 'react';
import { VoiceRefreshContext } from './voiceRefreshContext';

export function useVoiceRefresh() {
  return useContext(VoiceRefreshContext);
}
