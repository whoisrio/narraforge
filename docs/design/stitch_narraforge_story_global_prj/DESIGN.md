---
name: NarraForge Studio
colors:
  surface: '#fff8f1'
  surface-dim: '#dfd9d2'
  surface-bright: '#fff8f1'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f9f3eb'
  surface-container: '#f3ede6'
  surface-container-high: '#ede7e0'
  surface-container-highest: '#e8e1db'
  on-surface: '#1d1b17'
  on-surface-variant: '#534439'
  inverse-surface: '#33302c'
  inverse-on-surface: '#f6f0e9'
  outline: '#867467'
  outline-variant: '#d8c2b4'
  surface-tint: '#8e4e10'
  primary: '#8b4c0d'
  on-primary: '#ffffff'
  primary-container: '#a96425'
  on-primary-container: '#fffbff'
  inverse-primary: '#ffb77e'
  secondary: '#865310'
  on-secondary: '#ffffff'
  secondary-container: '#feb86f'
  on-secondary-container: '#784703'
  tertiary: '#00685d'
  on-tertiary: '#ffffff'
  tertiary-container: '#008376'
  on-tertiary-container: '#f4fffb'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#ffdcc3'
  primary-fixed-dim: '#ffb77e'
  on-primary-fixed: '#2f1500'
  on-primary-fixed-variant: '#6e3900'
  secondary-fixed: '#ffdcbd'
  secondary-fixed-dim: '#feb86f'
  on-secondary-fixed: '#2c1600'
  on-secondary-fixed-variant: '#683c00'
  tertiary-fixed: '#8cf5e4'
  tertiary-fixed-dim: '#6fd8c8'
  on-tertiary-fixed: '#00201c'
  on-tertiary-fixed-variant: '#005048'
  background: '#fff8f1'
  on-background: '#1d1b17'
  surface-variant: '#e8e1db'
typography:
  display-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.03em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  body-dialogue:
    fontFamily: Plus Jakarta Sans
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 29px
    letterSpacing: -0.01em
  body-base:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: -0.01em
  label-caps:
    fontFamily: Plus Jakarta Sans
    fontSize: 10px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.12em
  code-xs:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  unit: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  max-width: 1600px
---

## Brand & Style

The design system is built around a **Warm Stone & Amber Studio** aesthetic, specifically tailored for narrative creators, writers, and audio directors. It rejects the sterility of modern SaaS in favor of a tactile, literary workspace that evokes the feeling of a boutique recording studio.

The visual style is a sophisticated blend of **Minimalism** and **Tactile Modernism**. It prioritizes focused whitespace and high-legibility typography while incorporating physical metaphors—like copper accents, vacuum-tube glows, and springy, responsive hardware interactions. The goal is to create an atmosphere that feels professional, focused, and emotionally resonant.

**Key Stylistic Principles:**
- **Atmospheric Warmth:** Replacing cold grays with linen, parchment, and amber tones.
- **Floating Spatiality:** Interfaces leverage elevated layers with semi-transparent backdrops to create a sense of organized depth.
- **Physical Feedback:** Every interaction should feel mechanical, utilizing subtle scale transitions (`scale(0.97)` on click) and soft glow intensities.
- **Emotional Utility:** Using color not just for branding, but as a narrative tool to categorize the emotional delivery of text.

## Colors

The palette is rooted in organic, earthy tones that minimize eye strain during long-form writing and auditing sessions.

### Primary Foundation
- **Linen & Parchment:** The background uses `#f8f7f4` (Warm Linen) to provide a soft canvas, while `#ffffff` (Pure Parchment) is reserved for elevated content surfaces and cards.
- **Copper & Amber:** The primary brand color (`#c47a3a`) represents physical brass hardware. Use it for critical actions, active states, and focus indicators.

### Narrative Emotion Palette
Specialized semantic colors are used to tag dialogue segments based on emotional tone. These should be applied as soft-tinted backgrounds with 1px borders:
- **Radiant Happy:** Background `#fef9ef` | Border `#f0d080` | Accent `#e8a838`
- **Muted Sad:** Background `#f2f6fb` | Border `#a8c0d8` | Accent `#6b8db5`
- **Earthy Angry:** Background `#fdf2ef` | Border `#e09080` | Accent `#c45a4a`
- **Sage Calm:** Background `#f2f8f4` | Border `#a8ccb5` | Accent `#7ba68a`
- **Quiet Neutral:** Background `#ffffff` | Border `#e8e5de` | Accent `#9e978e`

### Functional States
- **Success/Playing:** `#2a9d8f` (Active Stream Teal) for playback and successful synthesis.
- **Warning/Dirty:** `#d4944e` for out-of-sync or modified dialogue.
- **Danger/Error:** `#c0392b` (Terracotta) for destructive actions or encoding failures.

## Typography

The system uses **Plus Jakarta Sans** for its warm, humanist geometric qualities, making it ideal for both structural UI and extended reading.

### Reading Experience
The **Body-Dialogue** role is the primary focus. It is set at `17px` with a generous `1.7` line height to ensure that long scripts can be audited and rehearsed without visual fatigue. For UI elements, **Body-Base** (`15px`) provides a crisp, professional contrast.

### Metadata & Technicals
Use a monospaced font (like **JetBrains Mono** or **SF Mono**) for technical readouts, including track index numbers, segment durations (`00:04.2`), and character count tags. This emphasizes the "studio tool" utility.

### Hierarchy
- **Display & Headlines:** Use tight line heights and negative tracking to create a strong, authoritative presence.
- **Eyebrows:** Use **Label-Caps** (uppercase with generous tracking) for categorizing sections or badge labels to create a structured, professional taxonomy.

## Layout & Spacing

The layout philosophy centers on **Centered Content Weighting**. While administrative tools sit in sidebars, the narrative canvas is positioned centrally to maintain focus on the prose.

### The Grid
- **Global Constraint:** The application width is capped at `1600px` to prevent interface sprawl on ultrawide monitors.
- **Rhythm:** A 4px-based spacing system governs all alignments.
- **Dialogue Cards:** Use a specific two-column grid: `90px` for the actor/index column and `1fr` for the text content.

### Adaptability
- **Desktop:** A fixed `248px` sidebar that can collapse into a `52px` icon strip.
- **Tablet/Mobile (Below 900px):** The vertical sidebar transforms into a horizontal scrollable strip below the header.
- **Padding:** Outer margins transition from `48px` (desktop) to `24px` (mobile).

## Elevation & Depth

Visual hierarchy is established through **Tonal Layers** and **Ambient Shadows**, mimicking the physical layering of studio hardware.

- **Floating Shell:** The primary header is elevated using a `1px solid #e8e5de` border and a dense, soft shadow (`0 4px 12px rgba(26, 24, 20, 0.08)`). It uses a 92% opaque backdrop blur to maintain contact with the content below.
- **Project Items:** Active project states in the sidebar should use a "physical inset" effect—an inner shadow or a `3px` left-border indicator to feel "pressed" into the surface.
- **Glows:** Selected elements do not just change border color; they emit a "vacuum tube" glow using the primary amber color at 15-30% opacity (`0 0 0 4px var(--glow)`).

## Shapes

The shape language is consistently **Rounded**, leaning towards a friendly but professional tool feel.

- **Standard Containers:** Use `0.5rem` (md) for cards and workspace modules.
- **Interactive Pill Components:** Use `9999px` (full) for primary CTA buttons and status badges to make them feel distinct from the structural grid.
- **Floating Header:** Uses an exaggerated `1.5rem` (xl) radius to emphasize its "floating" nature, separate from the edge of the screen.

## Components

### Buttons
- **Primary CTA:** Fully rounded (pill) with a gradient fill (`#c47a3a` to `#d4944e`). On hover, it scales up slightly (`1.03`). On click, it scales down (`0.97`) to provide tactile feedback.
- **Ghost Actions:** Use `#f3f2ee` (Pebble) for background with a subtle sandstone border.

### Dialogue Segment Cards
- **Structure:** A grid with a left metadata column and a right text column.
- **State Styling:** 
    - *Default:* Thin warm border (`#e8e5de`).
    - *Hover:* Border shifts to Primary Amber.
    - *Selected:* 2px Primary Amber border + amber outer glow.

### Floating Studio Header
- **Positioning:** Fixed 12px from top/left/right edges. 
- **Styling:** `rgba(248, 247, 244, 0.92)` background with a high blur.
- **Logo:** Displayed in a bold gradient text fill.

### Input Fields
- **Design:** Recessed (`surface-inset`) background with a thin sandstone border. Focus state triggers the primary amber border and a subtle inner glow.

### Waveform Decoration
- **Visuals:** Use miniature vertical bars with `rounded-full` corners. These should pulse dynamically using the Success Teal (`#2a9d8f`) when audio is active.