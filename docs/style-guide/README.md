# Alethia style guide

> Paper ground, hard black rules, one hot orange.

This folder is Alethia's visual language, packaged so you can use it outside
the editor. Every value here comes from the app's own stylesheets
(`src/renderer/styles/`, `src/renderer/editor/theme.ts`). Where the guide goes
further than the app, it says so (§12). Where the two disagree, the app wins
and this guide is wrong: fix the guide.

| File | Role |
|---|---|
| `index.html` | Start here. Orients a visitor, links to everything below, and shows every token and component live, in light and dark, drawn by `alethia.css`. Its contrast table is computed in the browser from `alethia.css`, so it cannot drift. |
| `README.md` | The rules and why they exist. Read this before you design anything new. |
| `alethia.css` | Drop-in stylesheet: fonts, tokens, `.al-*` chrome, `.al-prose` for plain HTML, code colours, print. Inert until an element opts in (§14). The machine-readable source for every value in this guide. |
| `tokens.json` | The same tokens in the Design Tokens Community Group (DTCG) Format Module 2025.10, for Figma plugins, Style Dictionary, Terrazzo and similar tools. |
| `fonts/` | The five WOFF2 files the system uses (Latin subset), with their SIL Open Font License (OFL) texts. |

The app icon is not copied here: `index.html` reads it from `build/icon.svg`,
and the screenshots from `docs/screenshots/`, so there is one of each.

To view the specimen, serve the repository root (browsers block web fonts on
`file://`) and open `/docs/style-guide/`:

```sh
python3 -m http.server 8000
```

### Where it lives in the app

| Concern | File |
|---|---|
| Tokens, fonts, dark mode | `src/renderer/styles/index.css` |
| App chrome: titlebar, sidebar, bars, buttons | `src/renderer/styles/shell.css` |
| Rendered markdown (`.cm-md-*`) | `src/renderer/styles/editor.css` |
| CodeMirror structure (measure, caret, panels) and the code palette | `src/renderer/editor/theme.ts` |
| Print overrides | `src/renderer/styles/print.css` |
| Icons | `build/icon.svg` (app), `src/renderer/components/icons.tsx` (UI) |
| Window size, sidebar width, theme source | `src/shared/settings.ts`, `src/main/windows.ts` |

Structural `.cm-*` overrides belong in `theme.ts`, not in a stylesheet:
CodeMirror injects its base theme after the app's CSS, so an equal-specificity
rule in plain CSS loses.

---

## 1. The idea

Alethia is named for ἀλήθεια, *disclosure*: the state of not being hidden.
In the editor the markdown source is never converted or tucked away. It is
covered by rendering, and uncovers itself wherever the caret is. The look
follows from that:

- **Nothing is softened.** No rounded corners, no shadows, no gradients, no
  translucent surfaces. A thing is either there, hard-edged, or it isn't.
- **Emphasis is a fill.** Important things get a solid block of colour behind
  them, not a tint, glow or underline.
- **Structure is a rule.** Panes, bars and tables are divided by solid lines of
  set weights, never by spacing alone and never by shading.
- **Depth is inversion.** To lift something, swap ink and paper. The titlebar,
  the active tab, a table's header row and a badge are all the same move.
- **One spot colour.** A hot orange, as in a two-colour print job. No second
  hue, ever. Variation comes from lightness steps of that one orange.
- **Three voices.** A grotesque for reading, a black display face for
  shouting, a monospace for everything that is not content.

The internal name for the direction, in the stylesheet header, is *Zine:
brutalist*. Think photocopied fanzine or a printer's proof, not a web
dashboard.

### Ten-second check

Something is in the Alethia style if:

1. The ground is warm paper `#f2f0eb` (or ink `#111111` in dark), not white or grey.
2. Every corner is square.
3. Every line is 2, 3, 6 or 8 px.
4. The only colour besides ink and paper is the orange, and the orange is
   either a fill with ink on it, or text on a dark ground.
5. Labels are small mono capitals with open tracking.
6. Headlines are Archivo Black capitals with tight tracking.
7. Nothing moves, except when it has to.

---

## 2. Colour

### 2.1 Palette

| Name | Hex | Role |
|---|---|---|
| Paper | `#f2f0eb` | Light ground; dark-mode text and rules |
| Ink | `#111111` | Light-mode text and rules; dark ground; text on every hot fill |
| Black | `#000000` | Dark-mode code well. Only in dark mode, and only there. |
| Hot | `#ff3b00` | The spot colour, used as a fill |
| Hot light | `#ff5722` | Dark-mode accent text |
| Hot tint | `#ff9166` | Code: types and classes |
| Rust | `#b52900` | Light-mode accent text; inline-code fill |
| Stone | `#5f5c55` | Muted text on paper |
| Stone light | `#a3a099` | Muted text on ink |
| Ash | `#8a8780` | Code: comments and operators |
| Sand | `#d8cfc0` | Code: strings |
| Blush | `#f5e0d6` | Light selection and row hover |
| Ember | `#4a2418` | Dark selection and row hover |

Everything except ink, paper and black is either the orange or a warm grey
that sits next to paper. There are no cool greys.

### 2.2 Semantic tokens

Use these names, never raw hex. They are the custom-property names the app
uses, so code can move between the app and anything built on `alethia.css`.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#f2f0eb` | `#111111` | Page ground |
| `--text` | `#111111` | `#f2f0eb` | Body text |
| `--text-muted` | `#5f5c55` | `#a3a099` | Secondary text, folders, sizes, empty states, `h6`, struck text |
| `--border` | `#111111` | `#f2f0eb` | Every rule, **and** the fill of every inverted band |
| `--accent` | `#b52900` | `#ff5722` | Orange that has to be readable as text on the ground: bullets, list numbers, caret, status identity, focus |
| `--accent-hot` | `#ff3b00` | `#ff3b00` | Orange as a fill: current row, hover, banners, links, the dirty mark, strong underline |
| `--on-hot` | `#111111` | `#111111` | Text on `--accent-hot` *(export addition)* |
| `--on-accent` | `#f2f0eb` | `#111111` | Text on `--accent` (inline code) |
| `--selection` | `#f5e0d6` | `#4a2418` | Text selection, row hover |
| `--code-bg` | `#111111` | `#000000` | Code well |
| `--code-fg` | `#f2f0eb` | `#f2f0eb` | Plain code text |

`--border` doing double duty is deliberate. A band is a very thick rule, so
the titlebar, active tab, table head and badge all use `--border` as
background and `--bg` as text. In dark mode they all turn paper-coloured
together, without any special cases.

### 2.3 The two oranges

The hot orange `#ff3b00` is the identity of the system, and it is
unreadable as text on paper: **3.14:1**, below the Web Content Accessibility
Guidelines (WCAG) AA floor of 4.5:1 for text. So the system splits it:

- **`--accent-hot`** is for *fills*. Ink on hot is **5.29:1** and passes AA.
  Hot as text on ink or black is fine too (5.29:1 and 5.88:1). That is why
  the code well can use it for keywords.
- **`--accent`** is for *text and thin marks* on the ground. In light mode it
  darkens to rust `#b52900` (**5.62:1** on paper). In dark mode it lifts to
  `#ff5722` (**5.97:1** on ink).

Rules:

- Text on a hot fill is always ink `#111111`, in both themes. Never paper,
  never white.
- Never set `--accent-hot` as text on paper. If something needs to be orange
  and readable on paper, it is `--accent`.
- One hot fill per region at a time. The current file in the tree, a banner,
  a hovered button: each one is "the" thing in its area. Several hot blocks
  side by side just read as noise.

### 2.4 Contrast reference

WCAG 2 relative-luminance ratios, computed from the hex values above. Text
needs 4.5:1 (AA) or 7:1 (AAA); large text and UI marks need 3:1. The same
table is computed live in `index.html`, so if the two ever differ, the CSS has
changed and this one is stale.

| Pair | Where | Ratio | WCAG |
|---|---|---|---|
| Ink on paper / paper on ink | Body text, both themes | 16.58 | AAA |
| Stone on paper | Muted text, light | 5.86 | AA |
| Stone light on ink | Muted text, dark | 7.23 | AAA |
| Rust on paper | `--accent` text, light: bullets, numbers, status identity | 5.62 | AA |
| Hot light on ink | `--accent` text, dark | 5.97 | AA |
| Ink on hot | Current row, banner, link, bold table cell | 5.29 | AA |
| Hot on ink / hot on black | Fence label and code keywords, light / dark well | 5.29 / 5.88 | AA |
| Hot on paper | Nowhere. **Fails for text.** Fills only. | **3.14** | Fail |
| Paper on rust | Inline code, light | 5.62 | AA |
| Ink on hot light | Inline code, dark | 5.97 | AA |
| Paper on hot light | Nowhere. **Fails.** Never paper text on the dark accent. | **2.78** | Fail |
| Ink on blush | Selection and row hover, light | 14.85 | AAA |
| Paper on ember | Selection and row hover, dark | 11.84 | AAA |
| Sand on ink / on black | Code strings, light / dark well | 12.23 / 13.61 | AAA |
| Hot tint on ink / on black | Code types, light / dark well | 8.54 / 9.49 | AAA |
| Ash on ink / on black | Code comments and operators, light / dark well | 5.27 / 5.86 | AA |

### 2.5 Code colours

The code well is ink `#111111` in light mode and black `#000000` in dark, so
code uses one light-on-dark set and never switches.

| Token | Value | Tokens |
|---|---|---|
| `--code-keyword` | `#ff3b00` | keywords |
| `--code-number` | `#ff3b00` | numbers, booleans, atoms |
| `--code-property` | `#ff3b00` | property names |
| `--code-type` | `#ff9166` | types, classes, namespaces |
| `--code-string` | `#d8cfc0` | strings |
| `--code-function` | `#f2f0eb` | function names |
| `--code-comment` | `#8a8780` | comments, *italic* |
| `--code-operator` | `#8a8780` | operators, punctuation |
| `--code-fg` | `#f2f0eb` | variables, everything else |

Syntax is orange, content is paper. Strings are content, so they read as
dimmed paper rather than as a second colour. There is still no second hue:
`--code-type` is one lighter step of the same orange.

Markdown's own syntax marks (a heading's `#`, emphasis asterisks) are
revealed on *paper*, not in the well, so they use `--text-muted`.

`alethia.css` maps these tokens onto CodeMirror/Lezer `tok-*` classes,
highlight.js `hljs-*` classes and Prism `.token.*` classes.

---

## 3. Typography

### 3.1 Faces

| Face | Weights | Role | Token |
|---|---|---|---|
| **Archivo** | 400, 600 | Reading: body text, prose | `--font-prose` |
| **Archivo Black** | 400 | Shouting: h1–h4, blockquotes, the wordmark, the image placeholder. Always in capitals. | `--font-display` |
| **DM Mono** | 400, 500 | Everything that isn't content: chrome, labels, buttons, file names, counts, tables, code, h5–h6 | `--font-mono` |

All three are under the SIL Open Font License (OFL) and are bundled rather
than fetched. The app works offline, and its content security policy allows
no network requests. Do the same anywhere it matters.

Only the weights above exist. Italics are synthesised by the browser: Archivo
for `em`, DM Mono for code comments. If you need a weight that isn't listed,
you have probably picked the wrong voice.

### 3.2 Which voice

- Will someone **read** it as running text? Use Archivo.
- Is it a **heading or a pull quote**, something that should hit? Use Archivo
  Black, in capitals.
- Is it a **label, a name, a number, a control, metadata, or code**? Use DM
  Mono. This is the default for anything in the chrome.

Never mix voices inside a role. A button is never set in Archivo, and a
paragraph is never set in mono.

### 3.3 Content scale

Sizes are in `em`, relative to the 1rem body, so the whole document scales
from one number.

| Element | Face | Size | Tracking | Leading | Case |
|---|---|---|---|---|---|
| Body | Archivo 400 | 1rem | 0 | 1.65 | Sentence |
| h1 | Archivo Black | 2.3em | −0.02em | 1.05 | CAPS |
| h2 | Archivo Black | 1.55em | −0.02em | 1.05 | CAPS |
| h3 | Archivo Black | 1.2em | −0.02em | 1.05 | CAPS |
| h4 | Archivo Black | 1.02em | 0 | 1.05 | CAPS |
| h5 | DM Mono 500 | 0.85em | +0.12em | 1.5 | CAPS |
| h6 | DM Mono 500, muted | 0.85em | +0.12em | 1.5 | CAPS |
| Blockquote | Archivo Black | 1.05em | 0 | 1.35 | CAPS |
| Strong | Archivo 600 | inherit | | | |
| Inline code | DM Mono | 0.88em | | | |
| Code block | DM Mono | 0.85em | | 1.65 | |
| Table | DM Mono | 0.85em | | | |
| Table head | DM Mono 500 | 0.85 × 0.85em | +0.12em | | CAPS |
| Front matter | DM Mono | 0.8em | +0.04em | | |

Below h4, the display face stops reading as a heading, so h5 and h6 switch to
the mono label voice. They stay in capitals: every heading level shares the
`.cm-md-heading` class, and only the face, size and tracking change.

### 3.4 Chrome scale

All chrome type is DM Mono, in `rem`, so it doesn't scale with the document.

| Token | Size | Tracking | Case | Used for |
|---|---|---|---|---|
| `--size-micro` | 0.62rem | +0.1em | CAPS | Small inline actions (*Clear*); the muted *Recent* heading in the empty sidebar |
| `--size-label` | 0.66rem | +0.08 to 0.1em | CAPS | Tabs, status bar, badges |
| `--size-ui` | 0.7rem | +0.06 to 0.08em | CAPS | Buttons, toolbar, workspace switcher (500, +0.06em), code-fence language label (+0.16em) |
| `--size-note` | 0.72rem | +0.02em (titlebar +0.1em CAPS) | Sentence | Banners, empty states, titlebar name |
| `--size-row` | 0.75rem | +0.02em | As written | File rows, outline rows, inputs |
| `--size-panel` | 0.78rem | | | Find/replace panel |

**Tracking rule.** The smaller and more capitalised the text, the more open the
tracking: +0.02em for lowercase rows, +0.06 to 0.1em for small caps, +0.16em for
the tiny fence label. Display caps go the other way and *tighten* (−0.02em).

**Case rule.** Chrome labels are CAPS (FILES, OUTLINE, 95 WORDS, OVERWRITE).
Messages are sentence case ("This file changed on disk since you loaded it.").
File names are shown exactly as they are on disk, except in the titlebar and
status bar, where the whole line is uppercased.

### 3.5 Measure and rhythm

- The writing column is **46rem** (`--measure`), centred, with 2.5rem top
  padding and 2rem side padding.
- Body leading is **1.65**.
- Blocks are separated by one empty line of body text, **1.65rem**
  (`--gap`). The editor has no paragraph margins: the blank line in the
  markdown *is* the gap. HTML should reproduce that.
- The editor leaves 30vh of space below the last line, so you never write at
  the bottom edge of the window.

---

## 4. Rules and shape

### 4.1 Rule weights

| Token | Weight | Used for |
|---|---|---|
| `--rule-thin` | 2px | Button and input borders, table cells, toolbar group dividers, the text caret, focus outline |
| `--rule` | 3px | Structure: sidebar edge, workspace switcher, toolbar and tab underlines, status bar top, banner bottom, search panel bottom, front-matter rule, image frame (dashed for a placeholder) |
| `--rule-heavy` | 6px | Horizontal rule in prose |
| `--rule-slab` | 8px | Blockquote |

Only these four weights exist. A 1px line looks like a web default and has no
place here. The one exception is inline code in print, which gets a 1px box
because a heavier one would overwhelm body-size text.

### 4.2 Corners

`border-radius: 0` everywhere: buttons, inputs, code wells, table cells,
inline code, badges.

That includes the corners you don't draw yourself, which is where curves get
back in:

- **Third-party components.** Libraries round their own chrome, often with
  fixed values their radius variables don't reach. Square everything under
  the component's root, not just the variables (§14).
- **Focus rings.** Left to the browser, macOS draws a rounded ring around a
  square control. Set your own: a 2px `--accent` outline, offset 2px, on
  `:focus-visible`. On a band the accent is too faint, so a band's controls
  take the band's text colour (paper on the ink titlebar, ink on hot). In the
  sidebar the outline is drawn inside, because the list clips anything
  outside its rows.
- **Checkboxes.** The native box is rounded. Draw it: a 2px square rule in
  the text colour, filled solid `--accent` when checked.

A rounded box holding square buttons (or the reverse) is the surest sign one
of these slipped through.

There are two places with curves, and neither one is ours. The macOS app-icon
mask (the icon tile is `rx=224` on 1024) belongs to the OS. The 24px stroke
icons have `rx=2` and round caps, inherited from a standard line-icon set; see
§12.

### 4.3 Depth

There are no shadows and no elevation. To lift something, invert it:

- **Band:** `background: var(--border); color: var(--bg)`. Used for the
  titlebar, the active tab, a pressed toolbar button, a table head and badges.
- **Hot band:** `background: var(--accent-hot); color: var(--on-hot)`. Used
  for the current row, hover, banners, pins and links.

The one `box-shadow` in the system isn't a shadow: `strong` uses
`inset 0 -3px 0 var(--accent-hot)` as a thick underline that sits behind the
descenders.

---

## 5. Layout

### 5.1 The window

```
┌──────────────────────────────────────────────────────────┐
│ ● ● ●  ▯  SHOWCASE.MD ■                   ← titlebar 38px │  ink band
├──────────────┬───────────────────────────────────────────┤
│ NOTES       ▾│ H1 H2 H3 ¶ ┃ B I S ` ┃ LINK QUOTE …       │  switcher, toolbar
│━━━━━━━━━━━━━━│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│  3px rules
│FILES│OUTL│HIST│ banner (only when a decision is needed)   │  tabs, hot band
│━━━━━━━━━━━━━━│                                           │  3px rule
│ ▾ notes      │        ┌──── 46rem measure ────┐          │
│   alpha.md   │        │ FIELD NOTES           │          │
│ ■ showcase.md│        │ Body text …           │          │
│   vtest.md   ┃        └───────────────────────┘          │
│   260px      ┃━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│  3px rule
│              ┃ 95 WORDS · 667 CHARACTERS     SHOWCASE.MD │  status bar
└──────────────┴───────────────────────────────────────────┘
```

| Measure | Value |
|---|---|
| Titlebar height | 38px (`--titlebar-h`). Starts 84px in, to clear the macOS traffic lights |
| Sidebar width | 260px by default, user-resizable. The app stores it in settings; `--sidebar-w` is the export's name for it |
| Window default | 1100 × 760 |
| Tree/outline indent | 8px + 12px per level |
| Icon button | 26 × 26px |
| Dirty mark | 7 × 7px square |
| List gutter | 1.6em per level |

The titlebar spans both columns and is the only drag region. Content starts
below it using padding, not by nesting inside it.

### 5.2 Spacing

Spacing is in rem and tight. The chrome is dense, like a printed form, and
the content column is where the air is.

| Context | Padding |
|---|---|
| Tree / list row | 0.3rem 0.6rem |
| Workspace switcher | 0.5rem 0.6rem |
| Tab | 0.55rem 0 |
| Button | 0.4rem 0.8rem |
| Toolbar button | 0.4rem 0.5rem, min-width 2.1rem |
| Banner | 0.5rem 1rem; actions gap 0.4rem |
| Status bar | 0.4rem 1rem |
| Badge | 0.05rem 0.4rem |
| Empty state | 1rem 0.75rem |
| Code block | 0.5em 1em |
| Table cell | 0.35em 0.8em |

---

## 6. Components

All of these exist in the app. The `.al-*` classes in `alethia.css` reproduce
them for plain HTML. Together they make the window in §5.1; `index.html`
builds it live from these classes.

### Titlebar — `.al-titlebar`
An ink band (`--border` background, `--bg` text), 38px high. Holds the
sidebar toggle and the document name, set in note-size mono caps tracked
+0.1em. In full screen it collapses to zero height.

### Dirty mark — `.al-dirty`
Unsaved work is a **7px hot square** after the name, never a soft dot. Use the
same mark for any "pending" state.

### Icon button — `.al-icon-button`
26px square, transparent, inherits colour. On hover: a hot fill with ink.

### Workspace switcher — `.al-workspace`
The open folder's name, sitting above the tabs like a vault name: a full-width
button in UI-size mono caps (500, +0.06em), padding 0.5rem 0.6rem, with a
muted `▾` on the right and a 3px rule underneath. Hover is a `--selection`
fill, like a row, because it behaves like one: it opens the list of recent
folders. With no folder open it reads "No folder".

### Tabs — `.al-tabs`
Equal-width cells (FILES, OUTLINE, HISTORY), label-size mono caps (500,
+0.08em), with a 3px rule underneath. The active tab inverts. There is no
underline indicator and no pill.

### Rows — `.al-row`
Mono 0.75rem, +0.02em, left-aligned, full width. They take three states:

| State | Treatment |
|---|---|
| Rest | Transparent, `--text`; folders in `--text-muted` |
| Hover | `--selection` fill |
| Current | `--accent-hot` fill, ink text, weight 500 |

Long names end in an ellipsis, never wrap. Trailing metadata (sizes, counts)
sits right-aligned in `--text-muted` at 0.68rem.

### Button — `.al-button`
A 2px outlined slab: mono 0.7rem caps, +0.08em, square. On hover it inverts.
Inside a banner, its border and text are ink, and on hover it fills ink with
hot text. There is no filled "primary" button: the action that matters is
the one in the banner.

### Toolbar — `.al-toolbar`
A strip of mono glyph buttons (H1 H2 H3 ¶ · B I S ` · LINK QUOTE BLOCK · LIST
1. —), split into groups by a 2px vertical rule inset 0.35rem. Each glyph
previews its effect: **B** in Archivo Black, *I* italic 600, ~~S~~ struck.

| State | Treatment |
|---|---|
| Hover | Hot fill, ink text |
| Active / pressed | Inverted band |

Buttons must not take focus on press, so the caret stays where it was.

### Banner — `.al-banner`
A full-width hot band with a 3px rule underneath. It's used for things that
need a decision: external changes, save conflicts, a restore that isn't saved
yet. Message on the left in note-size mono, actions on the right. It's
non-modal and never blocks typing. Use one banner at a time.

### Pin — `.al-pin`
A smaller hot strip that scopes a panel to one item (for example "History for
beta.md"), with a micro-size caps *Clear* action.

### Status bar — `.al-statusbar`
Label-size mono caps (+0.1em) with a 3px rule on top. Counts on the left
(`95 WORDS · 667 CHARACTERS`), identity on the right in `--accent`
(`SHOWCASE.MD · UNSAVED`). Active modes show as badges.

### Badge — `.al-badge`
A mode that is on (FOCUS, TYPEWRITER): an inverted band, no border.

### Input — `.al-input`
Square, 2px rule, mono 0.75rem. While editing, the rule turns `--accent`.
Rename happens in place, inside the row.

### Empty state — `.al-empty`
Muted mono at note size, in full sentences that say what to do next: "No
file open. Right-click a file to see its history." Add a button only when
there is exactly one obvious action ("Open Folder…").

### List heading — `.al-list-heading`
A muted micro-size caps label above a short list inside an empty state
(RECENT, above the recent folders), margin 1rem above and 0.25rem below. It
is the only heading the chrome has; it labels, it does not shout.

### Interaction model

| Meaning | Treatment |
|---|---|
| Pointing at | Hot fill + ink (buttons, toolbar), or blush/ember (rows) |
| Pressed / selected / active | Inversion (`--border` / `--bg`) |
| Current / the one that matters | Hot fill + ink, weight 500 |
| Needs a decision | Hot band (banner) |
| Unsaved / pending | 7px hot square |
| Keyboard focus | 2px `--accent` outline, offset 2px; on a band, the band's text colour; inside the sidebar, inset |

---

## 7. Content: how markdown renders

These are the rules behind `.al-prose`, taken from the editor's decoration
layer.

| Element | Treatment |
|---|---|
| **Headings** | See §3.3. h1–h4 are display caps; h5–h6 are mono caps. |
| **Strong** | Archivo 600 with a 3px hot underline *behind* the text (inset shadow). |
| **Emphasis** | Italic. Nothing else. |
| **Strikethrough** | 2px line, text drops to `--text-muted`. |
| **Inline code** | A solid `--accent` chip with `--on-accent` text, mono 0.88em, padding 0.05em 0.3em. Square. |
| **Link** | A hot chip with ink text, padding 0 0.2em, **no underline**. Hover inverts *(export addition)*. In the app, links open with ⌘-click. |
| **Horizontal rule** | A 6px solid bar. |
| **Blockquote** | An 8px slab on the left, 1em gap, Archivo Black caps at 1.05em, leading 1.35. Never a `>`. Never italic. |
| **Bullets** | Square glyphs in `--accent` at 0.8em, hung in a 1.6em gutter: `▪` at even depths, `▫` at odd. |
| **Ordered lists** | Mono 500 numbers in `--accent` at 0.85em, hung in the same gutter. The hang is capped at the gutter, so `10.` pushes its text along rather than crossing a quote's slab or the page edge. |
| **Tasks** | Bullet, then the drawn square checkbox (§4.2): a 2px rule in the text colour, a solid `--accent` square when checked. Done items go muted and are struck through. |
| **Code block** | A solid black slab, square, full measure, mono 0.85em, padding 0.5em 1em. The language is set top right in hot mono caps, 0.7rem, +0.16em. |
| **Table** | Mono 0.85em, 2px ink cell borders, head row inverted in caps (+0.12em, 500). A cell containing **bold** fills entirely with hot, because a chip floating inside a cell reads as a mistake. |
| **Image** | Inline with the text (`inline-block`, middle-aligned), at most the measure wide and `60vh` tall, with a 3px `--border` rule around it. |
| **Image placeholder** | When an image cannot be shown (document unsaved, remote source, file not found): the alt text (or the path) in Archivo Black at 0.85em inside a 3px *dashed* `--border` box, padding 0.5em 0.8em, with the reason under it at 0.7 opacity in a full sentence ("Image not found"). A not-found image's rule turns `--accent`. App only; `.al-prose` has no placeholder. |
| **Display math** | Centred, 0.3em vertical padding (KaTeX). |
| **Front matter** | Mono 0.8em, +0.04em, muted, behind a 3px muted rule. |

In the editor, all of this is a skin over the raw text. Put the caret on any
of it and the markdown syntax reappears in `--text-muted`. If you build
something interactive in this style, keep that principle: let the user get
at the source of what they're looking at.

---

## 8. Dark mode

Dark **inverts the paper; it does not soften it.** The contrast stays just as
high in both directions.

- Ground and text swap: ink ground, paper text.
- `--border` becomes paper, so every band turns paper-on-ink at once: the
  titlebar, active tab, table head and badges.
- `--accent` lifts from rust to `#ff5722`, so orange text stays readable on ink.
- `--accent-hot` does **not** change. Fills stay the same orange with ink on
  them.
- The code well goes from ink to pure black `#000000`, so the slab still
  reads as a slab against the ink ground. Panels (the search panel) stay on
  `--bg`.
- Selection goes from blush to ember.

Theme follows the OS (`prefers-color-scheme`). In the app, main sets
`nativeTheme.themeSource`, and the renderer only reads the media query. In
`alethia.css`, `data-al-theme="light"` or `data-al-theme="dark"` forces a
theme on an element and everything inside it.

The native window background is set to the theme ground (`#111111` or
`#f2f0eb`) before the page paints, so there is never a white flash.

---

## 9. Print

Print targets monochrome devices, including thermal printers, where solid
black is free and the orange would land as a muddy mid-grey. Fills that carry
meaning stay; inline fills become rules.

| Element | Screen | Print |
|---|---|---|
| Ground | Paper `#f2f0eb` | White. Cream dithers to a full-page grey |
| Text, rules, bands | Ink | Black |
| Orange, both tokens | `#ff3b00`, `#b52900` | Black. A mid-grey under black text is muddy |
| Code well | Ink or black slab, orange tokens | Black slab, white tokens; strings `#d0d0d0`, comments and operators `#b0b0b0`, comments still italic |
| Fence label | Hot on the slab | White on the slab |
| Table head, bold cell | Ink band, hot fill | Black fill, white text |
| Strong | 3px hot underline | 3px black underline |
| Link | Hot chip | 2px underline, offset 2px, no fill |
| Inline code | `--accent` chip | 1px black box: the one 1px line in the system (§4.1) |
| Bullets, numbers | `--accent` | Black |
| Focus dim | 25% opacity | 100% |
| Chrome | Visible | Hidden: titlebar, sidebar, toolbar, status bar, banner, search panel |
| Page | | 18mm top and bottom, 16mm sides (`@page`). Headings never end a page; tables do not split |

Backgrounds are forced with `print-color-adjust: exact`, or the slabs would
vanish. The `@page` rule is the one thing in `alethia.css` that cannot be
scoped to an element: it applies to whatever document is being printed.

---

## 10. Motion

There is almost none. State changes are instant: hover fills, inversions and
the chevron's 90° turn have no transitions. The one animation is focus mode,
where lines outside the caret's paragraph fade to 25% opacity over **200ms
ease**. Use motion only when something leaves the user's attention, never to
draw it.

---

## 11. Iconography and mark

### UI icons
24px grid, `stroke="currentColor"`, 1.5px stroke, no fill. Rendered at 18px
(sidebar toggle), 15px (file) and 14px (chevron). Icons inherit text colour,
so they invert and go hot with their row. The set is tiny on purpose: label
with words in mono caps before reaching for an icon.

### App icon (`build/icon.svg`)
A hot orange tile (`#ff3b00`, macOS mask `rx=224` on 1024), with a 36px ink
rule inset 64px that follows the mask's corners, and a black Greek **α** set
in a serif. It's the editor's hot table cell, grown into a tile. The rule
stays inside the app-switcher mask, including at the corners. The other SVGs
in `build/` are unshipped candidates; do not treat them as variants.

### Wordmark
"ALETHIA" in Archivo Black caps, tracking −0.02em. Pair it with ἀλήθεια in
mono label size and muted colour when the name needs explaining. The bundled
Latin subset of DM Mono has no Greek, so the Greek line falls back to the
system monospace. Load the Greek subset if that matters.

---

## 12. Gaps between the app and this guide

The export fixes or extends a few things that the app does not do yet. When
the app catches up, delete the row.

| Topic | App today | This guide |
|---|---|---|
| Link hover | None (links open with ⌘-click) | Inverts to an ink band |
| Disabled button | Not used | Dashed 2px rule, muted text, no hover |
| Text-on-fill colour | `#111111` hard-coded per rule | `--on-hot` token |
| Unused tokens | `--panel`, `--panel-fg`, `--accent-ink` are defined but never read (the search panel is set on `--bg`) | Left out |
| Icons | Rounded caps, `rx=2` file corners: the one soft element in the app | Kept as-is; if you redraw them, use square caps and miter joins |
| Image placeholder label | Asks for weight 700 in Archivo Black, which is bundled at 400 only, so the browser fakes the bold | Not reproduced |
| Reduced motion | The 200ms focus-dim transition always runs | Off under `prefers-reduced-motion: reduce` |
| `.al-input` | The rename input exists only while editing, so its 2px rule is always `--accent`; padding `1px 4px` | Padding matches the app. A resting 2px `--border` rule is added so the input can sit in a form; it turns `--accent` on focus |

---

## 13. Voice

The words follow the same rules as the pixels: plain, specific, unsoftened.

- **Say what happened, then what it means.** "This file was deleted or moved.
  Saving will recreate it." "Restored the version from Oct 12, 2026, 2:03 PM.
  Not saved yet."
- **Full sentences with full stops** in messages and empty states. **No
  exclamation marks**, no "Oops", no "Successfully".
- **Buttons are verbs, or the user's own words**: *Overwrite*, *Reload from
  disk*, *Keep mine*, *Dismiss*, *Undo*, *Clear*, *Save As*, *Reveal in
  Finder*. When an action loses something, say so: "Reload (discard my
  changes)".
- **Errors** have a title, *Could not {verb} {thing}* ("Could not save
  file"), and a body that gives the system's actual reason.
- **An ellipsis** (`…`, one character) marks an action that opens a dialog:
  *Open Folder…*.
- **The middle dot** ` · ` separates items in a line: `95 words · 667
  characters`, `showcase.md · unsaved`.
- **Numbers** are localised with thousands separators (`1,204 words`). Sizes
  are compact: `710B`, `3.4k`. Times are relative and short (`just now`,
  `46m ago`, `2h ago`, `3d ago`), with the exact time in a tooltip.
- **Shortcuts** use macOS glyphs, two spaces after the name: `Bold  ⌘B`,
  `Strikethrough  ⌃⇧X`.
- **The name** is *Alethia*. The Greek is ἀλήθεια. Describe the product on its
  own terms ("one editing surface", "the source is never hidden") rather than
  by comparison with other editors.

---

## 14. Using it elsewhere

### Plain HTML

```html
<link rel="stylesheet" href="alethia/alethia.css" />
<body class="al-page">
  <article class="al-prose">
    <h1>Field notes</h1>
    <p>The source is always here.</p>
  </article>
</body>
```

`alethia.css` loads its fonts relative to itself, so keep the `fonts/` folder
next to it. Loading the file changes nothing on its own: the tokens,
`color-scheme`, theme attribute, code-token colours and every component are
scoped to `.al-page`, `.al-prose`, `[data-al-theme]` or an `.al-*` class, and
a page that has none of those renders exactly as before. The one global rule is
`@page` in the print section (§9). The scope element can be `<html>`, `<body>`
or a wrapper `<div>`; the outermost one defines the tokens and nested ones
inherit its theme.

To force a theme, set `data-al-theme="light"` or `data-al-theme="dark"` on the
scope element, or on any element inside it:

```html
<html class="al-page" data-al-theme="dark">
```

### Rendered markdown (static sites, docs, READMEs)
Wrap the generated HTML in `.al-prose`. Put a code block's language in
`data-lang` on the `<pre>`. GitHub Flavored Markdown (GFM) task lists, tables
with `align`, and highlight.js or Prism output are styled as-is.

### Tailwind

```js
// tailwind.config.js — load alethia.css for the variables and fonts.
export default {
  theme: {
    borderRadius: { none: '0' },
    extend: {
      colors: {
        bg: 'var(--bg)', text: 'var(--text)', muted: 'var(--text-muted)',
        rule: 'var(--border)', accent: 'var(--accent)', hot: 'var(--accent-hot)',
        'on-hot': 'var(--on-hot)', selection: 'var(--selection)', well: 'var(--code-bg)',
      },
      fontFamily: {
        prose: 'var(--font-prose)', display: 'var(--font-display)', mono: 'var(--font-mono)',
      },
      borderWidth: { thin: '2px', rule: '3px', heavy: '6px', slab: '8px' },
    },
  },
}
```

Replacing `borderRadius` (rather than extending it) removes every rounded
utility, which is the point.

### CodeMirror 6
Use the editor's own theme from `src/renderer/editor/theme.ts`
(`editorTheme`, `codeHighlightStyle`). It reads the same custom properties.
Or use `alethia.css` with `classHighlighter` from `@lezer/highlight`, which
emits the `tok-*` classes styled here.

### Third-party components
Set the component's radius variables to 0, then square every element under
its root anyway: libraries also hard-code radii, at whatever specificity they
like, and mount tooltips and drag ghosts on `<body>`. Radius is the one
property worth `!important` here:

```css
.vendor-root,
.vendor-root *,
.vendor-root *::before,
.vendor-root *::after,
.vendor-tooltip,
.vendor-drag-ghost {
  border-radius: 0 !important;
}
```

Keep the variables at 0 as well, because a library's own `!important` rules
can read them and outrank yours. Swap in the library's own portal classes for
the tooltip and drag ghost. `*` does not reach slider and scrollbar thumbs, so
list them in a rule of their own: a pseudo-element an engine doesn't know
voids every selector in its rule.
[Tabula](https://github.com/billyhunt/tabula) does all of this for Excalidraw
in `src/renderer/styles/excalidraw.css`.

### Design tools
Import `tokens.json` (DTCG Format Module 2025.10). Colours are `srgb`
objects with a `hex` fallback; sizes are `{ value, unit }` in `px` or `rem`.
DTCG has no `em`, so values the CSS sets in `em` (the content type scale,
letter-spacing, the list gutter) are plain `number` tokens under `font-scale`,
`tracking` and `size.list-gutter`: multiples of the element's font size.
Semantic colours take their light value as `$value` and carry the dark alias
under `$extensions["com.alethia.mode"]`, which importers may ignore.

### Slides, posters, social images
Use paper ground, one display-caps headline, mono caps for the kicker and
footer, a 6px rule, and at most one hot block. If it needs a second colour,
it needs less on it instead.

---

## 15. Don'ts

- Don't round a corner, add a shadow, blur, or gradient. That counts for the
  corners you didn't draw: a library's chrome, the browser's focus ring, a
  native checkbox.
- Don't put hot orange text on paper. Don't put white or paper text on the
  hot orange.
- Don't add a second hue, a "success green" or an "error red". A problem gets
  a hot banner and a plain sentence.
- Don't underline links on screen. Fill them.
- Don't set the display face in lowercase, or chrome in Archivo.
- Don't use 1px rules, or any weight outside 2/3/6/8.
- Don't tint a background to show state. Fill it or invert it.
- Don't use pure white or pure black grounds on screen. Pure black is only
  for the dark-mode code well, and white is only for print.
- Don't animate for attention.
- Don't float a chip inside a table cell. Fill the cell.
- Don't fetch a font or an asset from the network.
- Don't add a colour without adding its print override (§9).
