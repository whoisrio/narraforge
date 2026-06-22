# Dialogue View, Global Role Library, and Local Prosody Control Design

Date: 2026-06-22

## Summary

NarraForge already supports segment-first multi-part narration. This design adds three connected capabilities without replacing the current segmented project model:

1. A backend-backed global role library for reusable speaker assets.
2. A dialogue view that renders one `Segment` as one chat bubble or narration block.
3. Local prosody marks that let users select part of a sentence and assign emotion, speaking style, or an advanced instruction.

The existing list editor remains available. The new dialogue view is an alternate view over the same `Segment` data.

## Goals

- Support multi-role dubbing scripts where each role has a reusable voice configuration.
- Support narration inside dialogue projects with its own narrator voice.
- Let users control tone at sentence and sub-sentence level.
- Preserve existing segment-first project structure and generated-audio stale detection.
- Keep old projects safe when global role definitions change.
- Reuse the existing emotion color system in chat bubbles and narration blocks.

## Non-goals for the first version

- No dialogue-turn grouping. One bubble or narration block is exactly one `Segment`.
- No chat-input “send message” workflow. Users add a new segment, then edit it.
- No automatic global-role synchronization into existing projects.
- No cross-device account system.
- No complete script DSL import/export.
- No Edge-TTS SSML dependency. Edge-TTS local prosody support uses split-and-concat fallback where needed.

## Existing Context

The current editor is hosted in `frontend/src/pages/TTSSynthesis.tsx` and uses the segmented project reducer from `frontend/src/hooks/useSegmentedProject.ts`. Projects are already three-layered: project, chapter, segment. Segments already have per-segment emotion, generated voice metadata, overrides, stale audio detection, and chapter-aware persistence.

The current emotion system is segment-level and presentation-oriented. It colors rows and edit controls, but it does not yet provide fine-grained sub-sentence control. This design keeps segment-level emotion and adds local marks as a finer-grained overlay.

## Data Model

### Global Role

Add a backend global role table and API. A role is a reusable speaker asset:

- `id`
- `name`
- `avatar`
- `description`
- `default_engine`
- `default_voice`
- `default_engine_params`
- `favorite_styles`
- `created_at`
- `updated_at`

`favorite_styles` stores common speaking-style presets for that role, such as “低声”, “温柔”, “紧张”, “慢速”, or engine-specific style hints. It starts simple and can evolve into a richer performance-style library later.

The role library is stored in the backend database first. It does not follow the current project storage mode.

### Segment Role Fields

Extend each segment with role and prosody data:

- `role_id`: optional reference to a global role.
- `role_snapshot`: a copy of the role voice configuration at the time the segment adopted or synchronized the role.
- `segment_kind`: `dialogue` or `narration`.
- `prosody_marks`: local sub-sentence marks.

`role_snapshot` prevents old projects from changing unexpectedly when a global role is edited. Global role updates only affect a segment after the user explicitly synchronizes.

### Narration Role

Multi-role projects also need narration voice configuration. Add a project-level narrator reference:

- `default_narrator_role_id`
- optional `default_narrator_snapshot`

A narration segment still has a role, voice, and engine parameters. It is only visually special: in dialogue view it renders as a centered narration block instead of a left or right chat bubble.

If a multi-role project enters dialogue view or generation with narration segments but no narrator voice, the UI must prompt the user to choose or create a narrator role.

### Prosody Mark

A `prosody_mark` describes a local range inside one segment’s text:

- `id`
- `start`
- `end`
- `emotion` optional
- `style_tags`
- `instruction` optional
- `intensity` optional

`start` and `end` are character offsets into the segment text. `style_tags` cover common controls such as low voice, emphasis, pause, slower, faster, softer, or louder. `instruction` is an advanced natural-language performance direction.

The segment’s existing `emotion` remains the overall emotion. It drives the bubble or narration-block color. A prosody mark can override or add emphasis to a local range inside that segment.

## Dialogue View UX

### View Switching

Add a view switch in the segmented editing area:

- List view: current `SegmentList` / `SegmentRow` editing experience.
- Dialogue view: new chat-style script editor.

Both views edit the same project, chapter, and segment data. Switching views must not alter segment order, content, or generated metadata.

### Rendering Rules

- `segment_kind = dialogue`: render as a chat bubble.
- `segment_kind = narration`: render as a centered narration block.
- One bubble or narration block equals one segment.
- Bubble and narration-block styling inherits the existing segment emotion color system.
- Each dialogue bubble shows role avatar, role name, engine/voice summary, text, local prosody highlights, and audio status.
- Stale audio indicators reuse the existing generated-params comparison concept.

### Adding Segments

Dialogue view uses script-editor semantics, not chat-tool semantics:

- Users click “+ 新增台词” or “+ 新增旁白”.
- The app creates an empty segment in the current chapter.
- The new segment inherits the currently selected role or the project narrator role.
- The user edits the newly created bubble or block.

There is no bottom chat input that sends messages.

### Editing a Segment

In dialogue view, users can:

- Change segment kind between dialogue and narration.
- Select or change the role.
- Edit text.
- Set segment-level emotion.
- Select text and add local prosody marks.
- Play or regenerate audio for that segment.
- Open role management or role synchronization controls.

The implementation should avoid growing `TTSSynthesis.tsx` further. New components and hooks should own dialogue-specific behavior.

### Local Prosody UI

Use text-highlight tags for local prosody marks:

1. User selects text inside a bubble or narration block.
2. A small editor opens near the selection.
3. User chooses emotion, style tags, intensity, or an advanced instruction.
4. The selected text is highlighted inline.
5. If a local emotion exists, its local highlight color takes priority over the segment’s overall emotion color.

The overall bubble still inherits the segment-level emotion color. Local marks are visible inside that bubble as finer-grained annotations.

## Role Library and Synchronization

### Role Management

Add a role library panel backed by backend APIs. It supports:

- List roles.
- Create role.
- Edit role metadata, avatar, default engine, voice, parameters, and favorite styles.
- Delete role.

Proposed API shape:

- `GET /api/roles`
- `POST /api/roles`
- `PUT /api/roles/{id}`
- `DELETE /api/roles/{id}`

The final route names can follow existing FastAPI naming conventions.

### Applying a Role

When a segment selects a role:

1. Store `role_id`.
2. Store `role_snapshot` with current voice configuration.
3. Use the snapshot for generation.

The snapshot makes generated behavior reproducible even if the global role is later edited.

### Active Synchronization

If a segment snapshot differs from the current global role, the UI can show that the role has updates. The user may synchronize:

- Current segment.
- Current chapter.
- Entire project for that role.

Synchronization updates snapshots and marks affected generated audio as stale.

### Deleted Roles

If a global role is deleted, existing segments keep their snapshots. They can still display and generate from the snapshot. The UI should show that the global role no longer exists and offer rebinding to another role.

## Generation Behavior

### Voice Configuration Priority

When generating a segment, resolve voice configuration in this order:

1. Segment manual override.
2. Segment `role_snapshot`.
3. Project narrator role or project default role snapshot.
4. Current global control bar configuration for backwards compatibility.

This keeps old projects usable while making role-based projects predictable.

### Stale Audio Detection

Generated metadata should include the effective voice and prosody inputs. A segment becomes stale when any of these change:

- Text.
- Role or role snapshot.
- Engine, voice, or engine parameters.
- Segment-level emotion.
- Local `prosody_marks`.
- Manual overrides.

### Prosody Capability Adapter

Introduce a small capability layer per engine:

- `supportsEmotion`
- `supportsStyleTags`
- `supportsInstruction`
- `supportsSsml`
- `requiresSplitFallback`

The UI can use these capabilities to explain behavior. For example, Edge-TTS should not be presented as having reliable SSML support. For Edge-TTS, local prosody should use hidden split-and-concat fallback when needed.

### Split-and-Concat Fallback

If an engine cannot apply local marks natively:

1. Internally split the segment text into hidden subsegments around prosody marks.
2. Apply mapped emotion/style/instruction to each hidden part as best as the engine supports.
3. Generate each hidden part.
4. Concatenate audio into one segment-level output.
5. Keep the UI as one bubble or narration block.

If a hidden subsegment fails, the whole segment generation fails. The UI should show which local range failed and allow retry. Partial audio must not be treated as a successful segment result.

## Migration and Compatibility

Old segments without role fields remain valid.

- Missing `role_id` means no linked global role.
- Missing `role_snapshot` means fall back to existing per-segment overrides or global controls.
- Missing `segment_kind` defaults to narration or an inferred safe default.
- Missing `prosody_marks` defaults to an empty array.

Frontend IndexedDB project schema, backend segmented project schemas, and SQLAlchemy models must agree on the new fields. Backend role-library tables require database migration support following the project’s current migration approach.

## Frontend Components

Add focused components and hooks instead of expanding `TTSSynthesis.tsx` heavily:

- `ChatSegmentView`
- `ChatBubble`
- `NarrationBlock`
- `ProsodyMarkEditor`
- `RolePicker`
- `RoleLibraryPanel`
- `RoleSyncPrompt`

The dialogue view should reuse existing voice avatar, emotion color, audio player, generation, stale-state, and segmented reducer patterns where possible.

## Testing Plan

Follow the project’s TDD workflow.

Backend tests:

- Role CRUD.
- Role deletion leaves segment snapshots usable.
- Segmented project schema reads and writes role/prosody fields.
- Narrator role validation for dialogue projects.

Frontend tests:

- Reducer updates role and prosody fields immutably.
- View switching preserves segment data.
- Narration block appears for narration segments.
- Chat bubble inherits emotion color.
- Missing narrator voice prompt appears when needed.
- Prosody mark edits update only the target segment.

Generation tests:

- Effective voice configuration priority.
- Role synchronization marks generated audio stale.
- Prosody mark changes mark audio stale.
- Split-and-concat failure does not create successful partial audio.

E2E coverage:

- Create a role.
- Create or open a dialogue project.
- Configure narrator voice.
- Add a dialogue segment.
- Add a local prosody highlight.
- Generate or verify stale audio behavior.

## Implementation Notes

This is a multi-phase feature. A safe implementation sequence is:

1. Add role-library backend model, schemas, service, API, and tests.
2. Extend segment data model and project migration logic.
3. Add frontend role API service and role management panel.
4. Add reducer actions for role snapshots and prosody marks.
5. Add dialogue view rendering with emotion-colored bubbles and narration blocks.
6. Add local text-selection prosody editor.
7. Add generation resolution and stale detection support.
8. Add split-and-concat fallback for unsupported local prosody.
9. Add E2E coverage for the main workflow.

Each phase should keep existing list-view editing and legacy generation working.
