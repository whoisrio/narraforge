import type { TTSLocalRecord, STTLocalRecord } from '../types';

const DB_NAME = 'voice_clone_studio';
const DB_VERSION = 1;
const TTS_STORE = 'tts_results';
const STT_STORE = 'stt_results';

/** 打开/创建 IndexedDB 数据库 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(TTS_STORE)) {
        db.createObjectStore(TTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STT_STORE)) {
        db.createObjectStore(STT_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function storePut(db: IDBDatabase, storeName: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function storeGetAll<T>(db: IDBDatabase, storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result as T[]);
    request.onerror = () => reject(request.error);
  });
}

function storeGet<T>(db: IDBDatabase, storeName: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

function storeDelete(db: IDBDatabase, storeName: string, key: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------------------------------------------------------------------------
// TTS 结果管理
// ---------------------------------------------------------------------------

/** 保存合成结果到 IndexedDB */
export async function saveTTSResult(record: TTSLocalRecord): Promise<void> {
  const db = await openDB();
  await storePut(db, TTS_STORE, record);
}

/** 获取所有 TTS 合成历史，按时间倒序 */
export async function getTTSHistory(): Promise<TTSLocalRecord[]> {
  const db = await openDB();
  const results = await storeGetAll<TTSLocalRecord>(db, TTS_STORE);
  return results.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/** 删除单条 TTS 合成记录 */
export async function deleteTTSResult(id: string): Promise<void> {
  const db = await openDB();
  await storeDelete(db, TTS_STORE, id);
}

/** 获取指定记录的音频 Blob */
export async function getTTSAudioBlob(id: string): Promise<Blob | null> {
  const db = await openDB();
  const record = await storeGet<TTSLocalRecord>(db, TTS_STORE, id);
  return record?.audioBlob ?? null;
}

// ---------------------------------------------------------------------------
// STT 结果管理
// ---------------------------------------------------------------------------

/** 保存字幕识别结果到 IndexedDB */
export async function saveSTTResult(record: STTLocalRecord): Promise<void> {
  const db = await openDB();
  await storePut(db, STT_STORE, record);
}

/** 获取所有 STT 识别历史，按时间倒序 */
export async function getSTTHistory(): Promise<STTLocalRecord[]> {
  const db = await openDB();
  const results = await storeGetAll<STTLocalRecord>(db, STT_STORE);
  return results.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

/** 删除单条 STT 识别记录 */
export async function deleteSTTResult(id: string): Promise<void> {
  const db = await openDB();
  await storeDelete(db, STT_STORE, id);
}