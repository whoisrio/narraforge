import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioPreview } from './AudioPreview';
import { CapabilitiesContext } from '../../hooks/useCapabilities';
import { LOCAL_CAPABILITIES, type Capabilities } from '../../services/capabilities';
import { voiceApi } from '../../services/api';

vi.mock('../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/api')>();
  return {
    ...actual,
    voiceApi: {
      ...actual.voiceApi,
      upload: vi.fn(),
      createUploadUrl: vi.fn(),
      uploadFromStorage: vi.fn(),
      createCloneMiMo: vi.fn(),
      delete: vi.fn(),
    },
  };
});

const mockedVoiceApi = vi.mocked(voiceApi);

const WORKERS_CAPABILITIES: Capabilities = {
  ...LOCAL_CAPABILITIES,
  deploy_target: 'workers',
  features: { ...LOCAL_CAPABILITIES.features, direct_storage_upload: true },
};

const SIGNED = {
  upload_url: 'https://proj.supabase.co/storage/v1/object/upload/sign/voice-assets/data/voices/profiles/x.mp3?token=tok',
  storage_path: 'data/voices/profiles/x.mp3',
  token: 'tok',
};

function makeFile(name = 'sample.mp3', type = 'audio/mpeg') {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

function renderPreview(caps: Capabilities, file: File, onCloneSuccess = vi.fn()) {
  render(
    <CapabilitiesContext.Provider value={caps}>
      <AudioPreview file={file} engine="mimo" onCloneSuccess={onCloneSuccess} onCancel={vi.fn()} />
    </CapabilitiesContext.Provider>,
  );
  return onCloneSuccess;
}

function clickClone() {
  fireEvent.click(screen.getByRole('button', { name: /MiMo-TTS/ }));
}

describe('AudioPreview 直传 Supabase Storage（Vercel 适配）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    mockedVoiceApi.createUploadUrl.mockResolvedValue(SIGNED);
    mockedVoiceApi.uploadFromStorage.mockResolvedValue({ id: 'v-direct' } as never);
    mockedVoiceApi.upload.mockResolvedValue({ id: 'v-local' } as never);
    mockedVoiceApi.createCloneMiMo.mockResolvedValue({} as never);
  });

  it('direct_storage_upload=true：签名 URL → 直传 Supabase → storage_path 建声音（不走 multipart）', async () => {
    const onCloneSuccess = renderPreview(WORKERS_CAPABILITIES, makeFile());
    clickClone();

    await waitFor(() => expect(onCloneSuccess).toHaveBeenCalled());

    expect(mockedVoiceApi.createUploadUrl).toHaveBeenCalledWith('sample.mp3', 'audio/mpeg');
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      SIGNED.upload_url,
      expect.objectContaining({ method: 'PUT' }),
    );
    expect(mockedVoiceApi.uploadFromStorage).toHaveBeenCalledWith(
      SIGNED.storage_path, undefined, undefined, undefined,
    );
    expect(mockedVoiceApi.upload).not.toHaveBeenCalled();
    expect(mockedVoiceApi.createCloneMiMo).toHaveBeenCalledWith('v-direct', undefined, undefined, undefined, undefined);
  });

  it('direct_storage_upload=false（local）：维持原 multipart 上传路径不变', async () => {
    const onCloneSuccess = renderPreview(LOCAL_CAPABILITIES, makeFile());
    clickClone();

    await waitFor(() => expect(onCloneSuccess).toHaveBeenCalled());

    expect(mockedVoiceApi.upload).toHaveBeenCalled();
    expect(mockedVoiceApi.createUploadUrl).not.toHaveBeenCalled();
    expect(mockedVoiceApi.uploadFromStorage).not.toHaveBeenCalled();
    expect(mockedVoiceApi.createCloneMiMo).toHaveBeenCalledWith('v-local', undefined, undefined, undefined, undefined);
  });

  it('直传成功但克隆失败：回滚删除已创建的声音记录', async () => {
    mockedVoiceApi.createCloneMiMo.mockRejectedValue(new Error('mimo down'));
    const onCloneSuccess = renderPreview(WORKERS_CAPABILITIES, makeFile());
    clickClone();

    await waitFor(() => expect(mockedVoiceApi.delete).toHaveBeenCalledWith('v-direct'));
    expect(onCloneSuccess).not.toHaveBeenCalled();
  });

  it('直传 PUT 失败：不创建声音记录并报错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const onCloneSuccess = renderPreview(WORKERS_CAPABILITIES, makeFile());
    clickClone();

    await waitFor(() => expect(screen.queryByRole('button', { name: /MiMo-TTS/ })).toBeEnabled());
    expect(mockedVoiceApi.uploadFromStorage).not.toHaveBeenCalled();
    expect(mockedVoiceApi.createCloneMiMo).not.toHaveBeenCalled();
    expect(onCloneSuccess).not.toHaveBeenCalled();
  });
});
