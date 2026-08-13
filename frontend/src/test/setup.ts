import '@testing-library/jest-dom';
import { vi } from 'vitest';

// jsdom 的 Blob 缺少 arrayBuffer()（node 原生 Blob 有）；经 FileReader 补上，
// 否则从 IndexedDB 读出的 Blob 无法转 bytes（projectBundle/exportToFolder 依赖）。
if (typeof Blob !== 'undefined' && typeof (Blob.prototype as { arrayBuffer?: unknown }).arrayBuffer !== 'function') {
  (Blob.prototype as unknown as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer = function arrayBuffer(this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as ArrayBuffer);
      fr.onerror = () => reject(fr.error);
      fr.readAsArrayBuffer(this);
    });
  };
}

// Force zh-CN locale in tests: many legacy specs assert on Chinese strings, and
// TranslationProvider's default is en-US (see i18n/index.tsx). Set localStorage
// before any component mounts so the initial useState picks zh-CN.
if (typeof window !== 'undefined') {
  window.localStorage.setItem('narraforge-locale', 'zh-CN');
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
class MockIntersectionObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
  writable: true,
  value: MockIntersectionObserver,
});

// Mock ResizeObserver
class MockResizeObserver {
  observe = vi.fn();
  disconnect = vi.fn();
  unobserve = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
  writable: true,
  value: MockResizeObserver,
});