# Apple Visual Language Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current Material Design visual tokens with Apple design tokens from design.md, changing only CSS variable values and hardcoded colors — no layout or logic changes.

**Architecture:** Update the two CSS token files (`variables.css`, `design-system.css`) with Apple values, then fix hardcoded colors in `global.css`, `App.module.css`, all CSS Modules, and `Button.tsx`. Add Inter font via Google Fonts. The CSS variable indirection means most inline-styled UI components update automatically.

**Tech Stack:** React, TypeScript, CSS Modules, CSS Custom Properties, Inter (Google Fonts)

---

### Task 1: Add Inter Font

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Add Inter Google Fonts link**

In `frontend/index.html`, add the Inter font link inside `<head>` before the existing `<link>` tag:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet" />
```

- [ ] **Step 2: Verify the page loads**

Run: `cd frontend && npm run dev`
Expected: Page loads at http://localhost:5173 without console errors

- [ ] **Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "feat: add Inter font via Google Fonts"
```

---

### Task 2: Update variables.css with Apple Tokens

**Files:**
- Modify: `frontend/src/styles/variables.css`

- [ ] **Step 1: Replace all token values**

Replace the entire content of `frontend/src/styles/variables.css` with:

```css
/* Global CSS Variables — Apple Visual Language */

:root {
  /* Colors */
  --color-primary: #0066cc;
  --color-primary-light: #0071e3;
  --color-primary-dark: #0055aa;
  --color-success: #4caf50;
  --color-warning: #ff9800;
  --color-error: #f44336;

  /* Background & Surface */
  --color-background: #f5f5f7;
  --color-surface: #ffffff;
  --color-surface-hover: #fafafc;
  --color-surface-active: #f0f0f0;

  /* Text */
  --color-text-primary: #1d1d1f;
  --color-text-secondary: #7a7a7a;
  --color-text-disabled: #bdbdbd;
  --color-text-on-primary: #ffffff;

  /* Borders */
  --color-border: #e0e0e0;
  --color-border-light: #f0f0f0;
  --color-border-focus: #0071e3;

  /* Spacing */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 17px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;
  --spacing-3xl: 64px;

  /* Typography */
  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-base: 17px;
  --font-size-lg: 18px;
  --font-size-xl: 21px;
  --font-size-2xl: 24px;
  --font-size-3xl: 34px;

  --font-weight-regular: 400;
  --font-weight-medium: 600;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Border Radius */
  --radius-sm: 5px;
  --radius-md: 8px;
  --radius-lg: 18px;
  --radius-xl: 18px;
  --radius-full: 9999px;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
  --transition-slow: 350ms ease;

  /* Z-Index Scale */
  --z-dropdown: 100;
  --z-sticky: 200;
  --z-fixed: 300;
  --z-modal-backdrop: 400;
  --z-modal: 500;
  --z-popover: 600;
  --z-tooltip: 700;
}

/* Dark mode support (future) */
@media (prefers-color-scheme: dark) {
  :root {
    /* Can add dark mode variables here */
  }
}
```

Key changes:
- Primary blue: `#1976d2` → `#0066cc` (Action Blue)
- Background: `#f5f5f5` → `#f5f5f7` (Parchment)
- Text primary: `#212121` → `#1d1d1f` (Near-Black Ink)
- Text secondary: `#757575` → `#7a7a7a` (Ink Muted 48)
- Border focus: `#1976d2` → `#0071e3` (Focus Blue)
- Base font size: `16px` → `17px`
- Spacing md: `16px` → `17px`
- Font weight medium: `500` → `600` (Apple skips 500)
- Radius lg/xl: `12px`/`16px` → `18px`/`18px`
- Radius sm: `4px` → `5px`
- Surface hover: `#f8f9fa` → `#fafafc` (Pearl)
- Border light: `#eeeeee` → `#f0f0f0` (Divider Soft)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/styles/variables.css
git commit -m "feat: update variables.css with Apple design tokens"
```

---

### Task 3: Update design-system.css with Apple Tokens

**Files:**
- Modify: `frontend/src/styles/design-system.css`

- [ ] **Step 1: Replace all token values**

Replace the `:root` block in `frontend/src/styles/design-system.css` with:

```css
:root {
  /* Semantic Colors */
  --color-primary: #0066cc;
  --color-secondary: #2997ff;
  --color-success: #4caf50;
  --color-danger: #f44336;
  --color-warning: #ff9800;
  --color-info: #00bcd4;

  /* Background Colors */
  --color-background: #f5f5f7;
  --color-surface: #ffffff;

  /* Text Colors */
  --color-text-primary: #1d1d1f;
  --color-text-secondary: #7a7a7a;
  --color-text-muted: #cccccc;

  /* Border Colors */
  --color-border: #e0e0e0;
  --color-border-light: #f0f0f0;
  --color-border-dark: #cccccc;

  /* Spacing Scale */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 17px;
  --spacing-lg: 24px;
  --spacing-xl: 32px;
  --spacing-2xl: 48px;
  --spacing-3xl: 64px;

  /* Typography */
  --font-family-body: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-family-heading: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
  --font-family-mono: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, monospace;

  /* Font Sizes */
  --font-size-xs: 12px;
  --font-size-sm: 14px;
  --font-size-base: 17px;
  --font-size-lg: 18px;
  --font-size-xl: 21px;
  --font-size-2xl: 24px;
  --font-size-3xl: 34px;
  --font-size-4xl: 40px;

  /* Font Weights */
  --font-weight-normal: 400;
  --font-weight-medium: 600;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  /* Line Heights */
  --line-height-tight: 1.07;
  --line-height-normal: 1.47;
  --line-height-relaxed: 1.75;

  /* Shadows — Apple uses no card shadows; hairline borders instead */
  --shadow-sm: none;
  --shadow-md: 0 0 0 1px rgba(0, 0, 0, 0.08);
  --shadow-lg: 0 0 0 1px rgba(0, 0, 0, 0.08);
  --shadow-xl: 0 0 0 1px rgba(0, 0, 0, 0.08);

  /* Border Radius */
  --radius-sm: 5px;
  --radius-md: 8px;
  --radius-lg: 18px;
  --radius-xl: 18px;
  --radius-full: 9999px;

  /* Transitions */
  --transition-fast: 150ms ease-in-out;
  --transition-normal: 250ms ease-in-out;
  --transition-slow: 350ms ease-in-out;

  /* Component-specific variables */
  --header-height: 44px;
  --nav-width: 240px;
}
```

Also update the dark mode block to use Apple dark-tile colors:

```css
@media (prefers-color-scheme: dark) {
  :root {
    --color-primary: #2997ff;
    --color-secondary: #4da3ff;
    --color-success: #66bb6a;
    --color-danger: #ef5350;
    --color-warning: #ffa726;
    --color-info: #26c6da;

    --color-background: #252527;
    --color-surface: #272729;

    --color-text-primary: #ffffff;
    --color-text-secondary: #cccccc;
    --color-text-muted: #7a7a7a;

    --color-border: #3a3a3c;
    --color-border-light: #333335;
    --color-border-dark: #48484a;

    --shadow-sm: none;
    --shadow-md: 0 0 0 1px rgba(255, 255, 255, 0.08);
    --shadow-lg: 0 0 0 1px rgba(255, 255, 255, 0.08);
    --shadow-xl: 0 0 0 1px rgba(255, 255, 255, 0.08);
  }
}
```

Also update the global body style in the same file. Change the `body` block to add Inter font feature settings and letter-spacing:

```css
body {
  margin: 0;
  font-family: var(--font-family-body);
  font-size: var(--font-size-base);
  line-height: var(--line-height-normal);
  color: var(--color-text-primary);
  background-color: var(--color-background);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-feature-settings: 'ss03' 1;
  letter-spacing: -0.01em;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/styles/design-system.css
git commit -m "feat: update design-system.css with Apple tokens and Inter font"
```

---

### Task 4: Update global.css

**Files:**
- Modify: `frontend/src/styles/global.css`

- [ ] **Step 1: Update font family and key styles**

In `frontend/src/styles/global.css`, make these changes:

Change the `html` font-size from `16px` to `17px`:
```css
html {
  font-size: 17px;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

Change the `body` font-family to use Inter:
```css
body {
  font-family: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
    Ubuntu, Cantarell, 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
  font-size: var(--font-size-base);
  line-height: 1.47;
  color: var(--color-text-primary);
  background-color: var(--color-background);
  min-height: 100vh;
  font-feature-settings: 'ss03' 1;
  letter-spacing: -0.01em;
}
```

Update focus style to use Apple focus blue:
```css
*:focus-visible {
  outline: 2px solid var(--color-border-focus);
  outline-offset: 2px;
}
```

Add active button state for Apple scale interaction:
```css
button:active:not(:disabled) {
  transform: scale(0.95);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/styles/global.css
git commit -m "feat: update global.css with Apple typography and interactions"
```

---

### Task 5: Update App.module.css — Remove Hardcoded Colors

**Files:**
- Modify: `frontend/src/App.module.css`

- [ ] **Step 1: Replace hardcoded colors with CSS variables**

Replace the full content of `frontend/src/App.module.css`:

```css
/* App Component Styles */

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--color-background);
}

/* Header */
.header {
  background: #000000;
  padding: 0 2rem;
  height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.logo {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-size: var(--font-size-lg);
  font-weight: 600;
  color: #ffffff;
  letter-spacing: -0.01em;
}

/* Tab Navigation */
.tabs {
  display: flex;
  gap: var(--spacing-xs);
}

.tab {
  padding: var(--spacing-xs) var(--spacing-md);
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  border-radius: var(--radius-full);
  cursor: pointer;
  font-size: var(--font-size-sm);
  transition: background var(--transition-normal);
  letter-spacing: -0.01em;
}

.tab:hover {
  background: rgba(255, 255, 255, 0.15);
}

.tab.active {
  background: var(--color-primary);
  color: white;
}

/* Main Content */
.main {
  flex: 1;
  padding: var(--spacing-2xl);
  max-width: 1200px;
  margin: 0 auto;
  width: 100%;
}

/* Empty State */
.emptyState {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  text-align: center;
  padding: var(--spacing-2xl);
}

.emptyIcon {
  font-size: 64px;
  margin-bottom: var(--spacing-lg);
  opacity: 0.5;
}

.emptyTitle {
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-semibold);
  color: var(--color-text-primary);
  margin-bottom: var(--spacing-sm);
}

.emptyHint {
  font-size: var(--font-size-base);
  max-width: 400px;
}

/* Loading State */
.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-secondary);
  font-size: var(--font-size-lg);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-right: var(--spacing-sm);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
```

Key changes:
- Header: white → true black (`#000000`) with white text
- Tab active: hardcoded `#3b82f6` → `var(--color-primary)`
- Tab: rounded rect → pill (`var(--radius-full)`)
- Background: hardcoded `#f5f5f5` → `var(--color-background)`
- All hardcoded colors replaced with CSS variables
- Added `letter-spacing: -0.01em` for Apple tight feel

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.module.css
git commit -m "feat: update App.module.css with Apple visual tokens"
```

---

### Task 6: Update Button.tsx — Pill Shape & Apple Colors

**Files:**
- Modify: `frontend/src/components/ui/Button.tsx`

- [ ] **Step 1: Update Button component**

Replace the full content of `frontend/src/components/ui/Button.tsx`:

```tsx
import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  fullWidth = false,
  disabled,
  children,
  className,
  ...props
}) => {
  const buttonStyle: React.CSSProperties = {
    transition: 'background-color var(--transition-normal), color var(--transition-normal), border-color var(--transition-normal), opacity var(--transition-normal), transform 0.1s ease',
    cursor: 'pointer',
    border: '1px solid transparent',
    fontFamily: 'inherit',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--spacing-xs)',
    opacity: disabled || loading ? 0.6 : 1,
    pointerEvents: disabled || loading ? 'none' : 'auto',
    width: fullWidth ? '100%' : 'auto',
    borderRadius: 'var(--radius-full)',
  };

  const getVariantStyles = () => {
    const variantStyles: Record<string, React.CSSProperties> = {
      primary: {
        backgroundColor: 'var(--color-primary)',
        color: 'white',
      },
      secondary: {
        backgroundColor: 'transparent',
        color: 'var(--color-primary)',
        borderColor: 'var(--color-primary)',
      },
      danger: {
        backgroundColor: 'var(--color-danger)',
        color: 'white',
      },
      ghost: {
        backgroundColor: 'var(--color-surface-hover)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border-light)',
        borderRadius: 'var(--radius-md)',
      },
    };
    return variantStyles[variant];
  };

  const getSizeStyles = () => {
    const sizes: Record<string, React.CSSProperties> = {
      sm: { padding: 'var(--spacing-xs) var(--spacing-md)', fontSize: 'var(--font-size-sm)' },
      md: { padding: '11px 22px', fontSize: 'var(--font-size-base)' },
      lg: { padding: '14px 28px', fontSize: 'var(--font-size-lg)', fontWeight: 300 },
    };
    return sizes[size];
  };

  return (
    <button
      style={{ ...buttonStyle, ...getVariantStyles(), ...getSizeStyles(), ...(className ? {} : {}) }}
      disabled={disabled || loading}
      className={className}
      aria-busy={loading}
      {...props}
    >
      {loading && <span style={{ display: 'inline-block', marginRight: '4px' }}>⟳</span>}
      {children}
    </button>
  );
};
```

Key changes:
- Primary button: `border-radius: var(--radius-full)` → pill shape
- Secondary button: transparent ghost pill with blue border (Apple `button-secondary-pill`)
- Ghost button: pearl capsule with `var(--radius-md)` (Apple `button-pearl-capsule`)
- Size md padding: `8px 16px` → `11px 22px` (Apple spec)
- Size lg: added `fontWeight: 300` (Apple `button-store-hero`)
- Added `transform 0.1s ease` transition for active scale

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/ui/Button.tsx
git commit -m "feat: update Button to Apple pill style"
```

---

### Task 7: Update VoiceClone.module.css — Remove Hardcoded Colors

**Files:**
- Modify: `frontend/src/pages/VoiceClone.module.css`

- [ ] **Step 1: Replace hardcoded colors with CSS variables**

Replace the full content of `frontend/src/pages/VoiceClone.module.css`:

```css
.container {
  max-width: 1200px;
  margin: 0 auto;
  padding: var(--spacing-2xl);
}

.header {
  margin-bottom: var(--spacing-2xl);
  text-align: center;
}

.header h1 {
  font-size: var(--font-size-3xl);
  margin-bottom: var(--spacing-sm);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.header p {
  color: var(--color-text-secondary);
}

.content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-2xl);
}

.inputSection,
.listSection {
  display: flex;
  flex-direction: column;
}

.card {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  border: 1px solid var(--color-border-light);
}

.card h2 {
  margin-bottom: var(--spacing-md);
  font-size: var(--font-size-xl);
  font-weight: 600;
}

.inputMethods {
  display: grid;
  gap: var(--spacing-md);
}

.method {
  background: var(--color-background);
  border-radius: var(--radius-md);
  padding: var(--spacing-md);
}

.method h3 {
  margin-bottom: var(--spacing-sm);
  font-size: var(--font-size-base);
}

.method p {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
  margin-bottom: var(--spacing-md);
}

.uploadProgress {
  margin-top: var(--spacing-md);
  text-align: center;
}

.progressBar {
  height: 4px;
  background: var(--color-border-light);
  border-radius: var(--radius-full);
  overflow: hidden;
  margin-bottom: var(--spacing-sm);
}

.progressFill {
  height: 100%;
  background: var(--color-primary);
  transition: width 0.3s;
}

.loading,
.empty {
  text-align: center;
  padding: var(--spacing-2xl);
  color: var(--color-text-secondary);
}

@media (max-width: 768px) {
  .content {
    grid-template-columns: 1fr;
  }
}
```

Key changes:
- All `#666` → `var(--color-text-secondary)`
- `#3b82f6` → `var(--color-primary)`
- `white` → `var(--color-surface)`
- `#f9f9f9` → `var(--color-background)`
- `#e5e5e5` → `var(--color-border-light)`
- Box shadows removed → `border: 1px solid var(--color-border-light)`
- Hardcoded `border-radius: 1rem` → `var(--radius-lg)` (18px)
- Heading font-weight → 600, added `letter-spacing: -0.02em`

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/VoiceClone.module.css
git commit -m "feat: update VoiceClone.module.css with Apple visual tokens"
```

---

### Task 8: Update TTSSynthesis.module.css — Remove Hardcoded Colors

**Files:**
- Modify: `frontend/src/pages/TTSSynthesis.module.css`

- [ ] **Step 1: Replace hardcoded colors with CSS variables**

Replace the full content of `frontend/src/pages/TTSSynthesis.module.css`:

```css
.container {
  max-width: 1400px;
  margin: 0 auto;
}

.header {
  margin-bottom: var(--spacing-2xl);
  text-align: center;
}

.header h1 {
  font-size: var(--font-size-3xl);
  margin-bottom: var(--spacing-sm);
  font-weight: 600;
  letter-spacing: -0.02em;
}

.header p {
  color: var(--color-text-secondary);
}

.content {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-2xl);
}

.leftColumn {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.rightColumn {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.textSection {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.textarea {
  width: 100%;
  padding: var(--spacing-md);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--font-size-base);
  resize: vertical;
  font-family: inherit;
}

.textarea:focus {
  outline: none;
  border-color: var(--color-border-focus);
  box-shadow: 0 0 0 2px rgba(0, 113, 227, 0.2);
}

.textInfo {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.clearButton {
  background: none;
  border: none;
  color: var(--color-primary);
  cursor: pointer;
  font-size: var(--font-size-sm);
}

.clearButton:hover:not(:disabled) {
  color: var(--color-primary-light);
}

.clearButton:disabled {
  color: var(--color-text-muted);
  cursor: not-allowed;
}

.generateButton {
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-full);
  padding: var(--spacing-md) var(--spacing-2xl);
  font-size: var(--font-size-lg);
  font-weight: 300;
  cursor: pointer;
  transition: background var(--transition-normal), transform 0.1s ease;
}

.generateButton:hover:not(:disabled) {
  background: var(--color-primary-light);
}

.generateButton:active:not(:disabled) {
  transform: scale(0.95);
}

.generateButton:disabled {
  background: var(--color-text-disabled);
  cursor: not-allowed;
}

@media (max-width: 768px) {
  .content {
    grid-template-columns: 1fr;
  }
}
```

Key changes:
- All `#666` → `var(--color-text-secondary)`
- `#1890ff`/`#40a9ff` → `var(--color-primary)`/`var(--color-primary-light)`
- `#3b82f6` → `var(--color-primary)`
- `#ddd` → `var(--color-border)`
- `#ccc` → `var(--color-text-muted)`
- `#d9d9d9` → `var(--color-text-disabled)`
- Focus shadow: `rgba(24, 144, 255, 0.2)` → `rgba(0, 113, 227, 0.2)` (Focus Blue alpha)
- Generate button: `border-radius: 0.5rem` → `var(--radius-full)` (pill)
- Generate button: `font-weight: 500` → `300` (Apple `button-store-hero`)
- Added `transform: scale(0.95)` active state on generate button

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/TTSSynthesis.module.css
git commit -m "feat: update TTSSynthesis.module.css with Apple visual tokens"
```

---

### Task 9: Update AudioPlayer.module.css

**Files:**
- Modify: `frontend/src/components/TTSSynthesis/AudioPlayer.module.css`

- [ ] **Step 1: Replace hardcoded colors**

Replace the full content of `frontend/src/components/TTSSynthesis/AudioPlayer.module.css`:

```css
.container {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  border: 1px solid var(--color-border-light);
}

.container h3 {
  margin-bottom: var(--spacing-md);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.loading,
.empty {
  text-align: center;
  padding: var(--spacing-2xl);
  color: var(--color-text-secondary);
}

.spinner {
  width: 2rem;
  height: 2rem;
  border: 2px solid var(--color-border-light);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto var(--spacing-md);
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading span {
  display: block;
}

.player {
  margin-bottom: var(--spacing-md);
}

.audio {
  width: 100%;
}

.downloadSection {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.downloadSection select {
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}

.downloadButton {
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  font-weight: 400;
}

.downloadButton:hover {
  background: var(--color-primary-light);
}

.downloadButton:active {
  transform: scale(0.95);
}

.info {
  color: var(--color-text-secondary);
  font-size: var(--font-size-sm);
}

.info p {
  margin: var(--spacing-xs) 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/TTSSynthesis/AudioPlayer.module.css
git commit -m "feat: update AudioPlayer.module.css with Apple visual tokens"
```

---

### Task 10: Update ParameterControls.module.css

**Files:**
- Modify: `frontend/src/components/TTSSynthesis/ParameterControls.module.css`

- [ ] **Step 1: Replace hardcoded colors**

Replace the full content of `frontend/src/components/TTSSynthesis/ParameterControls.module.css`:

```css
.container {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  border: 1px solid var(--color-border-light);
}

.container h3 {
  margin-bottom: var(--spacing-md);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: var(--spacing-md);
}

.control {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.control label {
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 600;
}

.control select,
.control input[type="range"] {
  width: 100%;
}

.control select {
  padding: var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  background: var(--color-surface);
}
```

Key change: label font-weight `500` → `600` (Apple skips weight 500)

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/TTSSynthesis/ParameterControls.module.css
git commit -m "feat: update ParameterControls.module.css with Apple visual tokens"
```

---

### Task 11: Update SynthesisHistory.module.css

**Files:**
- Modify: `frontend/src/components/TTSSynthesis/SynthesisHistory.module.css`

- [ ] **Step 1: Replace hardcoded colors**

Replace the full content of `frontend/src/components/TTSSynthesis/SynthesisHistory.module.css`:

```css
.container {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  margin-top: var(--spacing-md);
  border: 1px solid var(--color-border-light);
}

.container h3 {
  margin-bottom: var(--spacing-md);
  font-size: var(--font-size-lg);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.count {
  background: var(--color-primary);
  color: white;
  font-size: var(--font-size-xs);
  padding: 2px var(--spacing-sm);
  border-radius: var(--radius-full);
}

.empty {
  text-align: center;
  padding: var(--spacing-2xl);
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border-radius: var(--radius-lg);
}

.list {
  max-height: 480px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
}

.card {
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-md);
  padding: var(--spacing-sm) var(--spacing-md);
  transition: border-color var(--transition-fast);
}

.card:hover {
  border-color: var(--color-primary);
}

.cardHeader {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: 6px;
}

.textPreview {
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--color-text-primary);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.textPreview:hover {
  color: var(--color-primary);
}

.voiceBadge {
  font-size: var(--font-size-xs);
  background: var(--color-surface-active);
  color: var(--color-primary);
  padding: 2px var(--spacing-sm);
  border-radius: var(--radius-full);
  white-space: nowrap;
}

.cardMeta {
  margin-bottom: var(--spacing-sm);
}

.timestamp {
  font-size: var(--font-size-xs);
  color: var(--color-text-muted);
}

.cardActions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.audio {
  flex: 1;
  height: 2rem;
  min-width: 0;
}

.downloadButton {
  padding: 6px var(--spacing-sm);
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  font-size: 13px;
  font-weight: 400;
  text-decoration: none;
  white-space: nowrap;
}

.downloadButton:hover {
  background: var(--color-primary-light);
}

.downloadButton:active {
  transform: scale(0.95);
}

.deleteButton {
  padding: 6px var(--spacing-sm);
  background: none;
  color: var(--color-error);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-full);
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
}

.deleteButton:hover {
  background: var(--color-surface-active);
}
```

Key changes:
- `#3b82f6` → `var(--color-primary)` everywhere
- `#e5e5e5` → `var(--color-border-light)`
- `#666` → `var(--color-text-secondary)`
- `#333` → `var(--color-text-primary)`
- `#999` → `var(--color-text-muted)`
- `#f0f9ff` (voice badge bg) → `var(--color-surface-active)`
- `#ef4444`/`#fca5a5`/`#fef2f2` → `var(--color-error)` with pill border
- All buttons → pill shape (`var(--radius-full)`)
- Box shadow removed → `border: 1px solid var(--color-border-light)`

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/TTSSynthesis/SynthesisHistory.module.css
git commit -m "feat: update SynthesisHistory.module.css with Apple visual tokens"
```

---

### Task 12: Update VoiceSelector.module.css

**Files:**
- Modify: `frontend/src/components/TTSSynthesis/VoiceSelector.module.css`

- [ ] **Step 1: Replace hardcoded colors**

Replace the full content of `frontend/src/components/TTSSynthesis/VoiceSelector.module.css`:

```css
.container {
  background: var(--color-surface);
  border-radius: var(--radius-lg);
  padding: var(--spacing-lg);
  border: 1px solid var(--color-border-light);
}

.container h3 {
  margin-bottom: var(--spacing-md);
  font-size: var(--font-size-lg);
  font-weight: 600;
}

.group {
  margin-bottom: var(--spacing-md);
}

.group:last-child {
  margin-bottom: 0;
}

.group h4 {
  margin-bottom: var(--spacing-sm);
  font-size: var(--font-size-sm);
  color: var(--color-text-secondary);
  font-weight: 600;
}

.voiceList {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-sm);
}

.voice {
  display: inline-flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  border: 1px solid var(--color-border-light);
  border-radius: var(--radius-full);
  background: var(--color-surface);
  cursor: pointer;
  transition: all var(--transition-fast);
  position: relative;
}

.voice:hover {
  border-color: var(--color-primary);
}

.active {
  border-color: var(--color-border-focus);
  background: var(--color-surface-active);
}

.name {
  font-size: var(--font-size-sm);
}

.gender,
.tag {
  font-size: var(--font-size-xs);
  color: var(--color-text-secondary);
  background: var(--color-background);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.deleteBtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.25rem;
  height: 1.25rem;
  font-size: 1rem;
  line-height: 1;
  color: var(--color-text-muted);
  background: var(--color-background);
  border-radius: 50%;
  cursor: pointer;
  margin-left: var(--spacing-xs);
  transition: all var(--transition-fast);
}

.deleteBtn:hover {
  color: var(--color-error);
  background: var(--color-surface-active);
}

.loading,
.error,
.empty {
  text-align: center;
  padding: var(--spacing-lg);
  color: var(--color-text-secondary);
}

.error {
  color: var(--color-error);
}
```

Key changes:
- Voice chips: `border-radius: 0.5rem` → `var(--radius-full)` (pill)
- All hardcoded colors → CSS variables
- Label font-weight `500` → `600`
- Active state: `#eff6ff` → `var(--color-surface-active)`, border `#3b82f6` → `var(--color-border-focus)`

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/TTSSynthesis/VoiceSelector.module.css
git commit -m "feat: update VoiceSelector.module.css with Apple visual tokens"
```

---

### Task 13: Update App.css Title

**Files:**
- Modify: `frontend/index.html`

- [ ] **Step 1: Update page title**

Change the `<title>` in `frontend/index.html` from `frontend` to `Voice Clone Studio`.

- [ ] **Step 2: Commit**

```bash
git add frontend/index.html
git commit -m "chore: update page title to Voice Clone Studio"
```

---

### Task 14: Visual Verification

**Files:**
- None (testing only)

- [ ] **Step 1: Start dev server**

Run: `cd frontend && npm run dev`

- [ ] **Step 2: Verify Voice Clone page**

Open http://localhost:5173 and check:
- [ ] Inter font loads (check in browser DevTools computed styles)
- [ ] Header is black with white text and pill-shaped tabs
- [ ] Primary blue is `#0066cc` (not the old `#1976d2`)
- [ ] Body text is `#1d1d1f` on `#f5f5f7` background
- [ ] Cards have hairline borders instead of box shadows
- [ ] Card border-radius is 18px
- [ ] Buttons are pill-shaped (9999px radius)
- [ ] Body font-size is 17px

- [ ] **Step 3: Verify TTS Synthesis page**

Switch to the TTS tab and check:
- [ ] Generate button is pill-shaped with weight 300
- [ ] Textarea focus ring uses Focus Blue `#0071e3`
- [ ] Voice selector chips are pill-shaped
- [ ] History cards have hairline borders
- [ ] Download/delete buttons are pill-shaped

- [ ] **Step 4: Run production build**

Run: `cd frontend && npm run build`
Expected: Build succeeds with no errors

---

### Task 15: Final Commit (if any fixes needed)

- [ ] **Step 1: Commit any visual fixes discovered during verification**

```bash
git add -A
git commit -m "fix: visual adjustments from Apple token migration verification"
```
