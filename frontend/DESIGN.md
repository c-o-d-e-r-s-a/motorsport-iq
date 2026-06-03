# Motorsport IQ — Frontend Design System

> "Race Night" — a premium, mobile-first F1 prediction companion you use on your
> phone while watching the race. Not a desktop dashboard, not a dev tool.

This document covers the design tokens, typography, motion, and the rationale for
what was removed in the mobile-first UI overhaul. Presentation changed heavily;
socket clients also handle delta player events (`player_*`) for scaling.

---

## Principles

1. **Mobile-first (320–430px).** Every P0 screen is designed at 375×812 and
   390×844 first, then enhanced for tablet/desktop. Single-column flows, sticky
   action bars, thumb-friendly targets.
2. **The question moment is sacred.** During a live question the countdown,
   prompt, and YES/NO buttons fit on screen without scrolling.
3. **User language over telemetry jargon.** Players never see "SignalR",
   "OpenF1", "Groq/Llama", "trigger engine", or numbered section indices.
4. **Motion with purpose.** Question reveal, countdown pulse, win/lose feedback,
   podium reveal — all CSS/SVG, no animation library, friendly to mid-range phones.

---

## Design tokens (`src/app/globals.css`)

### Color — default dark theme (`:root`)
| Token | Value | Use |
|---|---|---|
| `--color-bg` / `--color-bg-2` | `#07090d` / `#0b0e14` | App background, gradients |
| `--color-panel` | `#12161f` | Cards |
| `--color-elevated` | `#1a1f2b` | Raised surfaces, inputs-on-card |
| `--color-muted` | `#161b25` | Chips, list rows |
| `--color-fg` / `--color-muted-fg` / `--color-faint-fg` | `#f6f8fb` / `#9aa6b8` / `#5d6878` | Text hierarchy |
| `--color-accent` / `--color-accent-hot` | `#ff2114` / `#ff4733` | Racing red — primary actions, brand |
| `--color-go` | `#1fd27a` | Green flag, YES, correct |
| `--color-warn` | `#ffc400` | Yellow/SC, mid countdown |
| `--color-danger` | `#ff3b3b` | Red flag, wrong, errors |
| `--color-info` | `#3d8bff` | Replay / neutral status |
| `--color-border` / `--color-border-strong` | `rgba(255,255,255,.08 / .16)` | Hairlines |

A light theme (`[data-theme='swiss']`) is retained **only** for the `/admin`
theme toggle. Player flows ship a single polished dark theme.

### Radius & elevation
`--radius-sm: 10px`, `--radius: 16px`, `--radius-lg: 24px`, `--radius-pill: 999px`.
Soft shadows (`--shadow`, `--shadow-lg`) and an accent glow (`--shadow-accent`).
The previous sharp `0px` "Swiss" radius was dropped for a tactile, app-like feel.

### Motion tokens
`--ease-out`, `--ease-spring`, and `--dur-fast/—/—slow` (140/240/420ms).
Keyframes + utilities: `animate-fade-up`, `animate-pop-in`, `animate-slide-up`,
`animate-pulse-ring` (urgent countdown), `animate-flash` (live indicators),
`animate-spin-slow`, `shimmer`, plus `mq-rise` confetti. All collapse under
`prefers-reduced-motion`.

### Safe areas
`viewportFit: 'cover'` in `layout.tsx` + `--safe-*` env vars and helpers
(`pad-safe-top`, `pad-safe-bottom`, `inset-safe-bottom`) so sticky bars and
content clear notches and home indicators. Sheets use
`pb-[max(1.5rem,var(--safe-bottom))]`.

---

## Typography
- **Display:** Barlow Condensed (600–800) — headings, big numbers, lap/score.
- **Body:** Inter — all reading copy.
- Question text and explanations render in normal case (readable), not the old
  all-caps micro-label style. Uppercase is reserved for short labels/chips.

---

## Components

### UI primitives (`src/components/ui/`)
- **Button** — pill, 44px+ targets, variants `primary | secondary | ghost |
  success | danger`, sizes `sm | md | lg` (h-10/12/14), press-scale feedback.
- **Card** — rounded surfaces, tones `default | muted | elevated | inverse`.
- **Input** — 56px tall, rounded, large text, focus ring.
- **Dialog** — bottom sheet on mobile (slide-up + grab handle), centered modal on
  desktop.
- **Chip** — pill status token with tones; used across HUD, lobby, resolution.
- **Brand** — inline SVG mark + wordmark (refreshed speed-chevron monogram),
  `mark` and `full` variants, theme-aware. Replaces the wide PNG-ish logo on
  mobile headers.
- **SectionLabel / ThemeToggle** — retained for `/admin` and `/simulate` only.

### Game components (`src/components/`)
- **CountdownTimer** — bold SVG ring with color shift (green→amber→red), glow,
  and `pulse-ring` in the final 10s. Sizes sm/md/lg.
- **QuestionCard** — category chip + difficulty, large readable prompt, two giant
  72px YES (green) / NO (red) buttons; selected answer highlighted, other dimmed.
- **RaceHud** — horizontally-scrollable chip row: lap, flag (`RaceConditionBadge`),
  P1 leader, replay speed, feed/connection. Replaces the tall header essay.
- **RaceConditionBadge** — flag chip with a colored dot (flashing on green),
  checkered swatch when chequered. Emoji-free.
- **TireStats** — compact leader card with tyre-compound color block + age/stint.
- **Leaderboard** — mobile list, medal ranks for top 3, current player highlighted
  with accent ring + "· you".
- **WinnerScreen** — animated podium (2-1-3 layout, staggered reveal), confetti,
  share button (`navigator.share` w/ clipboard fallback), back-to-lobby.

---

## Page architecture

### `/` (home) — P0
Single hero + access card. Driver name → **Create lobby** (primary) → divider →
code → **Join with code**. Inline warming-up banner (Render cold start) and
errors. Optional collapsible "How it works" (3 steps). Two-column on `lg`.

### `/lobby/[code]` — P0
Brand + Leave. Big lobby code with **Copy code / Copy link**. Grid (player) list
with host/you chips and live dots. Host: simplified session picker (location-led
cards, Live/Replay/Soon chips, tap-again-to-start) + **sticky bottom Start bar**.
Non-host: "Waiting for host" with spinner. Start confirmation is a bottom sheet.

### `/game/[code]` — P0
Sticky top: brand + Leave + `RaceHud` chip row. Stage renders one of:
Winner → Resolution → Live question → Question waiting → Idle. Live question
centers timer + `QuestionCard`. Resolution leads with a win/lose banner (+points),
correct/your-answer chips, plain-language explanation, and a **tucked-away**
"Something look wrong? Report it" link. Leaderboard + tyre stats stack below on
mobile, become a sticky right sidebar on `lg`.

### `/admin` — P1
Functional report/diagnostics console; inherits the new tokens (rounded cards,
pill buttons, dark theme). Kept structurally intact (internal tool).

---

## What was removed / hidden (and why)
- **Numbered `SectionLabel` indices** ("01 Race Interface", "04A Resolution",
  "Lobby Control") on player screens — engineering artifact, no user value.
- **Telemetry/AI plumbing copy** (OpenF1, Groq/Llama, SignalR, 10x replay
  pipeline, "server-side trigger engine") — replaced with one-line user language
  or dropped.
- **Home status widgets** — "Leader Proxy (Session)", "Top-3 Proxy (Session)",
  "Track Status", "Session Progress", the duplicated "Session Flow" marketing
  grid, the repeated 3-card feature blurbs, and footer ("Powered by OpenF1…",
  "Theme toggle available above"). `deriveHomeOpenF1Status` /
  `filterSessionsForDisplay` lib code is **untouched** — just no longer rendered
  on home.
- **The "Switch to Swiss" theme toggle** on player screens — players get one
  polished dark theme; the toggle lives on `/admin` only.
- **The tall in-game header paragraph** — replaced by the compact `RaceHud`.

## What was added
- Bottom-sheet dialogs, sticky action bars, `RaceHud`, `Chip`, refreshed `Brand`
  mark, "How it works" disclosure, share-result on the winner screen, safe-area
  handling, and a purposeful CSS motion layer.

---

## Constraints honored
- Socket events, `createLobby/joinLobby/reconnectLobby/submit_answer/start_session/
  presence_ping`, `lobby_state` reconnection, `useQuestionSound` /
  `useAnswerOutcomeSounds`, `apiFetch` reports, and `msp_username` / `msp_user_id`
  keys are unchanged.
- `npm run build`, `npm run lint`, and `npm test` (27 tests) all pass.
- No backend changes. No new runtime dependencies (CSS-only motion).
