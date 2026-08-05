/**
 * E2E test helpers — barrel export.
 */
export { enterWorkspace, openTestProject, goToRolePage, goToStudio, goToVoiceDesign, goToLibrary } from './navigation';
export { collectErrors } from './errors';
export { expectNoRawI18nKey, findRawI18nKeys } from './i18nGuard';
export { setLocaleToZhCN } from './locale';
export { E2E_BACKEND_PORT, E2E_FRONTEND_PORT, E2E_AGENT_PORT, E2E_BACKEND_URL, E2E_FRONTEND_URL, E2E_AGENT_URL } from './ports';
export { seedTestProject } from './seed';
export { readAgentThread, validateThreadState, verifyAgentStateWithScreenshot } from './langgraphAssertions';
export {
  readActiveProject,
  readBackendProject,
  readBackendProjects,
  interceptApiResponse,
  interceptPostResponse,
  interceptPutResponse,
  assertSegmentVoiceSource,
  assertSegmentHasAudio,
  assertSegmentHasText,
  assertVoiceSource,
  assertChapterVoice,
  assertSegmentTextEquals,
  assertValidEmotion,
  countReadySegments,
  totalSegmentCount,
  countSegmentsWithAudio,
  validateEngineParams,
  validateVoiceSource,
  validateAudioMeta,
  validateSplitConfig,
  validateSegment,
  validateChapter,
} from './dataAssertions';
// NOTE: dbReader (node:sqlite) is intentionally NOT re-exported from this barrel.
// Specs that read the DB should import it directly:
//   import { readDbProject, validateDbProjectRow } from '../helpers/dbReader';
// This keeps `node:sqlite` (Node >= 22.5) isolated to DB-reading specs so it
// cannot break unrelated specs on older Node runtimes.
