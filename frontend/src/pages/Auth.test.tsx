import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthPage } from './Auth';
import { AuthContext, type AuthContextValue } from '../hooks/authContext';

function renderAuthPage(auth: Partial<AuthContextValue>, props: { onSuccess?: () => void; onBack?: () => void } = {}) {
  const value: AuthContextValue = {
    user: null,
    isAdmin: false,
    isAnonymous: true,
    loading: false,
    sessionExpired: false,
    signIn: vi.fn().mockResolvedValue(undefined),
    signUp: vi.fn().mockResolvedValue(false),
    signOut: vi.fn().mockResolvedValue(undefined),
    clearSessionExpired: vi.fn(),
    ...auth,
  };
  const onSuccess = props.onSuccess ?? vi.fn();
  render(<AuthContext.Provider value={value}>
    <AuthPage onSuccess={onSuccess} onBack={props.onBack} />
  </AuthContext.Provider>);
  return { value, onSuccess };
}

function fillAndSubmit(submitLabel: '登录' | '注册' = '登录', email = 'a@b.c', password = 'secret1') {
  fireEvent.change(screen.getByTestId('auth-email-input'), { target: { value: email } });
  fireEvent.change(screen.getByTestId('auth-password-input'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: submitLabel }));
}

describe('AuthPage', () => {
  it('renders the login form by default and submits signIn', async () => {
    const { value, onSuccess } = renderAuthPage({});
    expect(screen.getByTestId('auth-page')).toBeInTheDocument();
    fillAndSubmit();
    await waitFor(() => expect(value.signIn).toHaveBeenCalledWith('a@b.c', 'secret1'));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('switches to signup mode and calls signUp', async () => {
    const { value, onSuccess } = renderAuthPage({});
    fireEvent.click(screen.getByRole('button', { name: '没有账号？立即注册' }));
    fillAndSubmit('注册');
    await waitFor(() => expect(value.signUp).toHaveBeenCalledWith('a@b.c', 'secret1'));
    // signUp 直接返回会话（未开邮箱验证）→ 视为登录成功
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it('shows a confirmation notice when signup requires email verification', async () => {
    const { onSuccess } = renderAuthPage({ signUp: vi.fn().mockResolvedValue(true) });
    fireEvent.click(screen.getByRole('button', { name: '没有账号？立即注册' }));
    fillAndSubmit('注册');
    expect(await screen.findByText('注册成功，请先到邮箱完成验证再登录。')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('shows an error message when signIn fails', async () => {
    const { onSuccess } = renderAuthPage({ signIn: vi.fn().mockRejectedValue(new Error('invalid')) });
    fillAndSubmit();
    expect(await screen.findByText('操作失败，请检查邮箱和密码后重试')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('surfaces the Supabase weak-password reason on signup', async () => {
    // 注册时 Supabase 服务端做密码策略校验；真实原因必须透出而非通用失败文案
    const weak = Object.assign(new Error('Password should be at least 6 characters'), {
      __isAuthError: true,
      code: 'weak_password',
    });
    const { onSuccess } = renderAuthPage({ signUp: vi.fn().mockRejectedValue(weak) });
    fireEvent.click(screen.getByRole('button', { name: '没有账号？立即注册' }));
    fillAndSubmit('注册');
    expect(await screen.findByText('密码不符合要求：至少 6 位，且不要使用常见弱密码')).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('renders a back button when onBack is provided', () => {
    const onBack = vi.fn();
    renderAuthPage({}, { onBack });
    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    expect(onBack).toHaveBeenCalled();
  });
});
