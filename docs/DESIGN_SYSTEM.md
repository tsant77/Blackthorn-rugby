# Design system

Status: Phase 1 tokens and inventory. Production components are added with shadcn/ui in Phase 2, on top of these tokens. The page at the web app root is a specimen, not a product screen.

## Brand source

Fetched from https://www.blackthornrugbyclub.com (Wix).

Logo file: `apps/web/public/brand/logo.jpg`

That file is the club crest downloaded from the site media library (`blackthorn full crest logo small`, original 2479×2704 JPEG). Header, favicon (`public/favicon-32.png`), and app icon (`public/apple-touch-icon.png`, `public/icon-192.png`) are that crest. Icons are padded square renders for browser chrome. The header uses the crest file itself on a white tile, because the artwork is drawn on white.

The club site's display face is Avenir Light and its body face is Lato. Its theme colors, read from the site CSS variables:

| Token | Hex | Site variable |
| --- | --- | --- |
| Forest | `#223017` | `--color_15` (primary text) |
| Sage | `#C5DAB5` | `--color_11` (site background and the title color `--color_36`) |
| Sage deep | `#9BB687` | `--color_12` |
| Pitch | `#679146` | `--color_13` |
| Leaf | `#45612F` | `--color_14` |
| Gold | `#F2B10B` | `--color_23` |
| Gold soft | `#FBE4AB` | `--color_21` |

The public site paints sage across the page. This product does not. The brief asks for a dark charcoal performance tool with a restrained accent. Sage remains a brand color for the wordmark and secondary labels. It is not the app background.

## Color

Canonical values: `apps/web/src/design/tokens.ts`. They are repeated in `src/styles/tokens.css`. A unit test fails if a hex drifts.

| Token | Hex | Use |
| --- | --- | --- |
| Canvas | `#121410` | Page background. Warm charcoal, green-biased so the crest's black does not look blue. |
| Raised | `#1B1E19` | Cards, header, bottom bar. |
| Overlay | `#242820` | Inputs on a raised card, menus. |
| Line | `#31362C` | Borders and dividers. |
| Ink | `#F4F6F1` | Primary text. About 17:1 on canvas. |
| Muted | `#A8AD9F` | Secondary text. About 8:1 on canvas. |
| Faint | `#8E9486` | Metadata that must still pass AA. About 5.9:1 on canvas. |
| Forest | `#223017` | Secondary button fill, gold button label. |
| Sage | `#C5DAB5` | Wordmark and secondary button label. About 12:1 on canvas, about 9:1 on forest. |
| Pitch | `#679146` | Positive state, spacing specimen, availability "available". |
| Leaf | `#45612F` | Pressed or deep green. Not for small text on canvas. |
| Gold | `#F2B10B` | The only accent. |
| Gold soft | `#FBE4AB` | Highlight text on charcoal. |
| Danger | `#A33B32` | Destructive actions. Functional color, not from the club palette. Light text on it is about 6:1. |

### Where gold is allowed

- Primary button fill, with forest text.
- The 4px bar under the header.
- Points, rank numerals, and the active bottom-nav item.
- Focus ring.

Gold is not for body text, links in paragraphs, or large backgrounds. One accent on a screen, not a gold UI.

shadcn semantic roles map as follows: `primary` is gold, `primary-foreground` is forest, `background` is canvas, `secondary` is forest, `destructive` is danger. The app is dark only. There is no light theme.

## Typography

| Role | Family | Weight | Use |
| --- | --- | --- | --- |
| Display | Barlow Condensed, Arial Narrow | 600 | Scores, ranks, big numbers. |
| Heading | Nunito Sans, Avenir Next, Century Gothic | 600 | Screen titles and the wordmark. Nunito Sans stands in for the club's Avenir. |
| Body | Lato, Helvetica Neue, Helvetica, Arial | 400 / 700 | Paragraphs, labels, tables. |

Avenir Light is the club site's heading weight. On charcoal it thins out and fails the brief's "strong athletic" hierarchy, so headings are semibold. Body copy stays Lato, which is the site's text face.

Load the three families from Google Fonts in `index.html`. Fallbacks are listed so a blocked font request still has a system stack.

## Spacing

8-point scale. Product screens use the named utilities, not one-off pixel values.

| Name | Pixels | Utility |
| --- | --- | --- |
| half | 4 | `p-half`, `gap-half` |
| s1 | 8 | `p-s1` |
| s2 | 16 | `p-s2` |
| s3 | 24 | `p-s3` |
| s4 | 32 | `p-s4` |
| s5 | 40 | `p-s5` |
| s6 | 48 | `p-s6` |
| s8 | 64 | `p-s8` |
| s10 | 80 | `p-s10` |
| s12 | 96 | `p-s12` |

`half` is the only half-step, for icon alignment and the crest tile. Do not invent 12px gaps.

The names are `s1`…`s12` on purpose. Tailwind already uses `sm`, `md`, `lg`, and `xl` for max-width, and in v4 those utilities read the spacing scale. Reusing those names collapsed `max-w-5xl` to a few dozen pixels. `text-quiet` is the muted ink (`#A8AD9F`). The utility is not `text-muted`, because shadcn's `--muted` is a surface color.

Tailwind's default numeric scale stays in place so shadcn components keep their intended padding. New product layout uses the names above.

## Shape, elevation, motion

- Radius 4px on inputs, 8px on cards and buttons, 16px only when a surface needs a larger corner. No full-bleed glass.
- Shadow is `0 1px 2px rgb(0 0 0 / 0.35)` (`shadow-card`). No glow, no gradient meshes.
- Transitions are short and only on color or opacity. The stylesheet collapses motion when `prefers-reduced-motion` is set.
- Focus is a 2px gold outline with 2px offset, visible on keyboard focus.

## Component inventory

Built in Phase 2 with shadcn/ui (`components.json` is ready). The specimen shows the visual target for the first six; it is not the library.

| Component | Notes |
| --- | --- |
| AppHeader | Crest tile, "Blackthorn Rugby", gold rule. Same on every page. |
| BottomNav | Mobile primary nav: Home, Log, Board, You. Active item is gold. |
| Button | Primary (gold/forest), secondary (forest/sage), ghost, danger. |
| IconButton | 44px target minimum. |
| TextField, Select, Textarea | Label above, error text in danger, hint in muted. |
| SegmentedControl | Week / month / offseason. |
| Card | Raised surface, line border, card shadow. |
| Stat | Display numeral plus a muted label. |
| PointsBadge | Awarded points after caps, plus a quiet note when a cap bound. |
| LeaderboardRow | Rank, roster name, session count, points. |
| WorkoutTypePicker | The seven types. Distance field appears only for running and rowing. |
| ActivityRow | Feed line: name, type, date, points. |
| Banner | Injury hold, cap reached, offline. |
| EmptyState | No players, no sessions, no results. |
| LoadingState | Skeleton in raised/line, not a spinner in the middle of a blank page. |
| ErrorBoundary | Per route, with a retry. |
| Dialog | Confirm void, confirm deactivate. |
| Toast | Short confirmation after a save. |
| Tabs | History filters. |
| DataTable | Admin lists. Stacks to cards under 640px. |
| ChartFrame | Phase 4. Axis labels in muted, series in sage and gold only. |

Every product page uses this set. No one-off gradients, no emoji as icons, no glassmorphism.

## Accessibility

- Body text at least AA on canvas. Gold is not used as small text on charcoal; gold-soft or ink is.
- Inputs have visible labels. Errors are text, not color alone.
- Bottom nav items are links or buttons with an accessible name. The active item sets `aria-current`.
- Target size at least 44px on primary actions.
- The specimen skip link is the pattern product pages will keep.

## Specimen

`apps/web` renders this system on one page so the tokens can be reviewed before product screens exist. Screenshots from that page:

- `docs/design/phase1-specimen-mobile.png`
- `docs/design/phase1-specimen-desktop.png`

## Files

| File | Role |
| --- | --- |
| `apps/web/src/design/tokens.ts` | Source hexes and the spacing table. |
| `apps/web/tailwind.config.ts` | Tailwind theme, loaded by `@config`. |
| `apps/web/src/styles/tokens.css` | shadcn CSS variables and base rules. |
| `apps/web/src/App.tsx` | Specimen only. |
| `apps/web/public/brand/logo.jpg` | Club crest. |
