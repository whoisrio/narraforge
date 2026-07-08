/**
 * E2E test helpers — barrel export.
 */
export { enterWorkspace, openTestProject, goToRolePage, goToStudio, goToVoiceDesign, goToLibrary } from './navigation';
export { collectErrors } from './errors';
export { setLocaleToZhCN } from './locale';
export { seedTestProject } from './seed';
export {
  readIndexedDBProjects,
  readIndexedDBProject,
  readActiveProject,
  readBackendProject,
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
  validateEngineParams,
  validateVoiceSource,
  validateAudioMeta,
  validateSplitConfig,
  validateSegment,
  validateChapter,
} from './dataAssertions';
