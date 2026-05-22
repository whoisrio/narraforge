# Frontend UI Improvements — Design Spec

**Date:** 2026-05-22
**Status:** Approved

## Overview

Improve the TTSSynthesis page layout to fix space issues and enhance usability. Three key changes:

1. Voice selector (CosyVoice mode) → dropdown menu
2. Parameter controls → collapsible panel (collapsed by default)
3. Voice list → add "Clear All" button

## Current Problems

- Parameter controls always occupy right-column space, squeezing the text input and audio player
- Voice selector uses chip/pill buttons that take excessive space when many voices exist
- Layout is unstable and not fixed

## Design Decisions

- **Collapsible panel** over Modal: less intrusive, no overlay, user can still see context
- **Dropdown** over chip list: compact, scales better, clearer selection UX
- **Edge-TTS mode** left unchanged

## Detailed Changes

### 1. VoiceSelector — Button List → Dropdown

**File:** `frontend/src/components/TTSSynthesis/VoiceSelector.tsx`
**File:** `frontend/src/components/TTSSynthesis/VoiceSelector.module.css`

Replace the chip/pill button list with a `<select>` dropdown using the existing `ui/Select` component or a native `<select>`.

- Show voice name (e.g., "My Voice 01 · Cloned")
- Remove individual delete button from dropdown (VoiceClone page already handles deletion)
- Handle loading/empty/error states same as before
- Auto-select first voice if none selected
- `onDelete` prop removed from VoiceSelectorProps

### 2. ParameterControls — Always Visible → Collapsible Panel

**File:** `frontend/src/components/TTSSynthesis/ParameterControls.tsx`
**File:** `frontend/src/components/TTSSynthesis/ParameterControls.module.css`

Add internal `useState` for collapsed/expanded state. Default: collapsed.

- Header bar: "⚙️ Parameter Settings" + expand/collapse arrow
- Click header to toggle
- Controls panel slides in/out (CSS max-height transition or display toggle)
- Parameter values preserved regardless of collapsed state

### 3. VoiceClone Page — Add "Clear All" Button

**File:** `frontend/src/components/VoiceClone/VoiceList.tsx`

Add a "🗑️ Clear All" button in the VoiceList header, next to "Sync from Qwen".

- Button styled with danger color (red outline)
- On click: `confirm("Delete all cloned voices? This cannot be undone.")`
- If confirmed: iterate through all voices and call `voiceApi.delete(id)` for each
- Refresh list after all deletions complete
- If no voices exist, button should be disabled

## Files Affected

| File | Change |
|---|---|
| `VoiceSelector.tsx` | Button list → `<select>` dropdown |
| `VoiceSelector.module.css` | Simplify styles for dropdown |
| `ParameterControls.tsx` | Add collapsed/expanded toggle |
| `ParameterControls.module.css` | Add collapsible panel styles |
| `TTSSynthesis.tsx` | Minor layout adjustment if needed |
| `VoiceList.tsx` | Add Clear All button + confirm |

## Out of Scope

- Edge-TTS panel changes
- Speech-to-text page changes
- Backend API changes
- VoiceClone page layout changes (other than Clear All button)

## Testing

- TSX unit tests should be updated for VoiceSelector and ParameterControls prop/state changes
- VoiceList test: verify Clear All button appears and triggers confirm