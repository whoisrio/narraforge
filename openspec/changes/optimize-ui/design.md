## Context

The Voice Clone Studio frontend currently uses inline React styles throughout all components (App.tsx, VoiceList.tsx, TTSControls.tsx, etc.). This creates:

- No style reusability across components
- Inconsistent spacing, colors, and borders
- Hard to maintain when styling needs to change
- No systematic approach to dark mode or theming
- Limited accessibility features

The existing `index.css` has some CSS custom properties defined for the Vite template but isn't utilized by the application components.

## Goals / Non-Goals

**Goals:**
- Create a comprehensive CSS design system with CSS custom properties for colors, spacing, typography, shadows, and borders
- Build a library of reusable UI components (Button, Card, Modal, Input, Select, Slider, Tabs, etc.)
- Refactor existing components to use the new design system
- Implement proper loading, error, and empty states with visual feedback
- Add smooth transitions and micro-interactions
- Support dark mode through CSS custom properties
- Improve accessibility with proper ARIA labels, focus states, and keyboard navigation
- Ensure responsive design works across mobile, tablet, and desktop

**Non-Goals:**
- Changing any backend APIs or functionality
- Implementing a full component library like MUI, Chakra UI, or Tailwind CSS
- Adding complex animation libraries
- Changing the application structure or routing

## Decisions

### CSS Custom Properties for Theming
**Decision:** Use CSS custom properties (CSS variables) for all design tokens including colors, spacing, typography, and component styles.

**Rationale:**
- Native browser support with no build dependencies required
- Enables easy theming and dark mode implementation
- Can be scoped to components when needed
- Works well with existing CSS setup

**Alternatives Considered:**
- *CSS-in-JS (styled-components, emotion)*: Rejected because it adds bundle size and build complexity
- *Tailwind CSS*: Rejected because it would require significant refactoring and adds large utility class overhead
- *Sass/Less*: Rejected because CSS custom properties provide similar benefits with less tooling

### Component Structure
**Decision:** Create reusable UI components in `frontend/src/components/ui/` directory using TypeScript and accepting props for variant styling.

**Rationale:**
- Separation of concerns between UI primitives and business logic
- Type safety with TypeScript props
- Easy to test and maintain independently

**Component Types:**
- Button (primary, secondary, danger, ghost variants)
- Card (with header, body, footer)
- Modal (with header, body, footer, close handler)
- Input (text, textarea variants)
- Select (dropdown)
- Slider (range input with labels)
- Tabs (for navigation between features)
- Loading (spinner, skeleton)
- Empty State (with icon, title, description, action)
- Alert (success, error, warning, info variants)

### State Management Pattern
**Decision:** Keep existing React state management (useState, useEffect) in components.

**Rationale:**
- Current state management works well for the application complexity
- No need to add Redux, Context API, or other state libraries
- Focus is on UI improvements, not state architecture

### Design Token Structure
**Decision:** Organize CSS custom properties by semantic categories with light/dark mode variants.

```
/* Colors */
--color-primary
--color-secondary
--color-success
--color-danger
--color-warning
--color-background
--color-surface
--color-text-primary
--color-text-secondary
--color-border

/* Spacing */
--spacing-xs
--spacing-sm
--spacing-md
--spacing-lg
--spacing-xl

/* Typography */
--font-family-body
--font-family-heading
--font-size-xs ... --font-size-xl
--font-weight-normal ... --font-weight-bold

/* Shadows */
--shadow-sm
--shadow-md
--shadow-lg

/* Border radius */
--radius-sm
--radius-md
--radius-lg

/* Transitions */
--transition-fast
--transition-normal
--transition-slow
```

## Risks / Trade-offs

**Risk:** Breaking existing functionality during component refactoring
→ **Mitigation:** Refactor incrementally, one tab at a time, test thoroughly after each change

**Risk:** Dark mode color contrast issues
→ **Mitigation:** Follow WCAG AA standards, test color contrast ratios, provide clear visual hierarchy

**Risk:** Increased CSS bundle size
→ **Mitigation:** Use component-scoped styles where appropriate, avoid unused CSS, leverage CSS minification

**Trade-off:** Initial development time vs. long-term maintainability
→ **Acceptance:** Investing upfront in design system will significantly speed up future development and maintenance

## Migration Plan

1. **Phase 1: Design System Foundation**
   - Create `frontend/src/styles/design-system.css` with CSS custom properties
   - Create `frontend/src/styles/variables.css` with semantic design tokens
   - Update `index.css` to import new design system

2. **Phase 2: UI Component Library**
   - Create base UI components in `frontend/src/components/ui/`
   - Implement Button, Card, Modal, Input, Select, Slider, Tabs
   - Implement Loading, Empty State, Alert components
   - Add TypeScript props interfaces and variants

3. **Phase 3: Refactor Voice Clone Tab**
   - Refactor VoiceList.tsx to use new components
   - Refactor AudioUploader.tsx to use new components
   - Refactor AudioRecorder.tsx to use new components
   - Test voice cloning flow end-to-end

4. **Phase 4: Refactor TTS Tab**
   - Refactor TTSControls.tsx to use new components
   - Refactor ModelSelector.tsx to use new components
   - Test text-to-speech flow end-to-end

5. **Phase 5: Refactor Timeline Tab**
   - Refactor Timeline.tsx to use new components
   - Refactor VideoPlayer.tsx to use new components
   - Refactor VideoUpload.tsx to use new components
   - Test timeline flow end-to-end

6. **Phase 6: App Layout & Navigation**
   - Refactor App.tsx to use new Tab component
   - Improve header styling with new design system
   - Ensure responsive layout works across breakpoints

**Rollback Strategy:** Since these are frontend-only changes, revert the commit to restore previous functionality.

## Open Questions

None - the design is straightforward with well-established patterns for CSS design systems and React components.
