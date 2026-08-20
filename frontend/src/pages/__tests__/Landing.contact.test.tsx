import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Landing from '../Landing';
import { TranslationProvider } from '../../i18n';

function renderLanding() {
  return render(
    <TranslationProvider>
      <Landing onNavigate={vi.fn()} />
    </TranslationProvider>,
  );
}

describe('Landing contact entry', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('shows a contact-us mailto link in the footer when admin email is configured', () => {
    vi.stubEnv('VITE_ADMIN_EMAIL', 'admin@example.com');
    renderLanding();

    const link = screen.getByRole('link', { name: /联系我们/ });
    expect(link).toHaveAttribute('href', 'mailto:admin@example.com');
  });

  it('omits the contact link when admin email is not configured', () => {
    vi.stubEnv('VITE_ADMIN_EMAIL', '');
    renderLanding();

    expect(screen.queryByRole('link', { name: /联系我们|Contact us/i })).not.toBeInTheDocument();
  });
});
