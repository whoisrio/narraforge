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
  },
  voiceDesign: {
    title: '音色设计',
    voiceProfile: '音色档案',
    clonedVoice: '克隆音色',
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
