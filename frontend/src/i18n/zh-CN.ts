export const zhCN = {
  nav: {
    projects: '项目',
    subtitles: '字幕识别',
    voiceDesign: '音色设计',
    settings: '设置',
  },
  projectNav: {
    overview: '总览',
    library: '文本库',
    studio: '工作室',
    voices: '声音角色',
    settings: '项目设置',
  },
  projectHub: {
    title: '项目工作台',
    newProject: '新建项目',
    recentProjects: '最近项目',
    continueProject: '继续制作',
  },
  subtitles: {
    title: '字幕识别',
    uploadMultiple: '上传多个文件',
    concatenateAndRecognize: '拼接并统一识别',
    studioKicker: 'Subtitle Studio',
    heroDescription: '把单文件、多文件、音视频素材统一放入 Ingest 流程，生成可编辑 Transcript，再统一校准、翻译和导出。',
    ingest: '素材导入',
    ingestDescription: '单文件快速识别，或把多个音频/视频片段加入队列后统一 ASR。',
    singleFile: '单文件',
    multiFileQueue: '多文件队列',
    historyAudio: '历史音频',
    transcriptEditor: '字幕文本',
    reviewExport: '校准与导出',
    boundaryMap: 'Boundary Map',
    backendPreview: '后端识别',
  },
  voiceDesign: {
    title: '音色设计',
    voiceProfile: '音色档案',
    clonedVoice: '克隆音色',
    backendPreview: '后端试听',
    saveProfile: '保存为 Voice Profile',
    profileLibrary: 'Voice Profile Library',
    designBrief: 'Design Brief',
    tuneLab: 'Tune Lab',
    projectRoleReady: 'Project Role Ready',
    previewGenerated: '试听已生成',
  },
  studio: {
    title: '配音工作室',
    listView: '列表视图',
    dialogueView: '对话视图',
    batchSynthesize: '批量合成',
  },
  voiceRole: {
    label: '声音角色',
    short: '声音',
    defaultNarrator: '默认旁白',
  },
};

type WidenStrings<T> = {
  [K in keyof T]: T[K] extends string ? string : WidenStrings<T[K]>;
};

export type Messages = WidenStrings<typeof zhCN>;
