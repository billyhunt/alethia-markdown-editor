# Alethia style guide

> Paper ground, hard black rules, one hot orange.

This folder is Alethia's visual language, packaged so you can use it outside
the editor. Every value here comes from the app's own stylesheets
(`src/renderer/styles/`, `src/renderer/editor/theme.ts`). Where the guide goes
further than the app, it says so.

| File | Use it for |
|---|---|
| `README.md` | The rules and why they exist. Read this before you design anything new. |
| `alethia.css` | Drop-in stylesheet: fonts, tokens, `.al-*` chrome, `.al-prose` for plain HTML, code colours, print. Inert until an element opts in (§14). |
| `tokens.json` | The same tokens in the W3C Design Tokens Format Module 2025.10 (DTCG), for Figma plugins, Style Dictionary, Terrazzo and similar tools. |
| `index.html` | A live specimen. Open it to check a theme, a component or a print run. |
| `fonts/` | The five WOFF2 files the system uses (Latin subset), with their OFL licences. |
| `assets/alethia-icon.svg` | The app icon. |

To view the specimen, serve the folder with `python3 -m http.server` (browsers
block web fonts on `file://`) and open `index.html`.

---

## 1. The idea

Alethia is named for ἀλήθεια, *disclosure*: the state of not being hidden.
In the editor the markdown source is never converted or tucked away. It is
covered by rendering, and uncovers itself wherever the caret is. The look
follows from that:

- **Nothing is softened.** No rounded corners, no shadows, no gradients, no
  translucency. A thing is either there, hard-edged, or it isn't.
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
unreadable as text on paper: **3.14:1**, below WCAG AA. So the system splits
it:

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

| Pair | Ratio | WCAG |
|---|---|---|
| Ink on paper / paper on ink | 16.58 | AAA |
| Stone on paper | 5.86 | AA |
| Stone light on ink | 7.23 | AAA |
| Rust on paper | 5.62 | AA |
| Hot light on ink | 5.97 | AA |
| Ink on hot | 5.29 | AA |
| Hot on paper | **3.14** | Fails for text. Fills only. |
| Paper on rust (light inline code) | 5.62 | AA |
| Ink on hot light (dark inline code) | 5.97 | AA |
| Paper on hot light | **2.78** | Fails. Never put paper text on the dark-mode accent. |
| Ink on blush | 14.85 | AAA |
| Paper on ember | 11.84 | AAA |
| Sand on black | 13.61 | AAA |
| Hot tint on black | 9.49 | AAA |
| Ash on black | 5.86 | AA |

### 2.5 Code colours

The code well is black in both themes, so code uses one light-on-dark set
and never switches.

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
| **Archivo Black** | 400 | Shouting: h1–h4, blockquotes, the wordmark. Always in capitals. | `--font-display` |
| **DM Mono** | 400, 500 | Everything that isn't content: chrome, labels, buttons, file names, counts, tables, code, h5–h6 | `--font-mono` |

All three are SIL Open Font License and are bundled rather than fetched. The
app works offline, and its content security policy allows no network
requests. Do the same anywhere it matters.

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
| h5 | DM Mono 500 | 0.85em | +0.12em | 1.5 | As written |
| h6 | DM Mono 500, muted | 0.85em | +0.12em | 1.5 | As written |
| Blockquote | Archivo Black | 1.05em | 0 | 1.35 | CAPS |
| Strong | Archivo 600 | inherit | | | |
| Inline code | DM Mono | 0.88em | | | |
| Code block | DM Mono | 0.85em | | 1.65 | |
| Table | DM Mono | 0.85em | | | |
| Table head | DM Mono 500 | 0.85 × 0.85em | +0.12em | | CAPS |
| Front matter | DM Mono | 0.8em | +0.04em | | |

Below h4, the display face stops reading as a heading, so h5 and h6 switch to
the mono label voice.

### 3.4 Chrome scale

All chrome type is DM Mono, in `rem`, so it doesn't scale with the document.

| Token | Size | Tracking | Case | Used for |
|---|---|---|---|---|
| `--size-micro` | 0.62rem | +0.1em | CAPS | Small inline actions (*Clear*) |
| `--size-label` | 0.66rem | +0.08 to 0.1em | CAPS | Tabs, status bar, badges |
| `--size-ui` | 0.7rem | +0.06 to 0.08em | CAPS | Buttons, toolbar, code-fence language label (+0.16em) |
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
| `--rule` | 3px | Structure: sidebar edge, toolbar and tab underlines, status bar top, banner bottom, front-matter rule |
| `--rule-heavy` | 6px | Horizontal rule in prose |
| `--rule-slab` | 8px | Blockquote |

Only these four weights exist. A 1px line looks like a web default and has no
place here. The one exception is inline code in print, which gets a 1px box
because a heavier one would overwhelm body-size text.

### 4.2 Corners

`border-radius: 0` everywhere: buttons, inputs, code wells, table cells,
inline code, badges.

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
│ FILES│OUTLINE│ H1 H2 H3 ¶ ┃ B I S ` ┃ LINK QUOTE …       │  toolbar
│──────┴───────│━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│  3px rule
│ ▾ notes      │ banner (only when a decision is needed)   │  hot band
│   alpha.md   │                                           │
│ ■ showcase.md│        ┌──── 46rem measure ────┐          │
│   vtest.md   │        │ FIELD NOTES           │          │
│              │        │ Body text …           │          │
│   260px      ┃        └───────────────────────┘          │
│              ┃━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│  3px rule
│              ┃ 95 WORDS · 667 CHARACTERS     SHOWCASE.MD │  status bar
└──────────────┴───────────────────────────────────────────┘
```

| Measure | Value |
|---|---|
| Titlebar height | 38px (`--titlebar-h`). Starts 84px in, to clear the macOS traffic lights |
| Sidebar width | 260px by default (`--sidebar-w`), user-resizable |
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
them for plain HTML.

### Titlebar — `.al-titlebar`
An ink band (`--border` background, `--bg` text), 38px high. Holds the
sidebar toggle and the document name, set in note-size mono caps tracked
+0.1em. In full screen it collapses to zero height.

### Dirty mark — `.al-dirty`
Unsaved work is a **7px hot square** after the name, never a soft dot. Use the
same mark for any "pending" state.

### Icon button — `.al-icon-button`
26px square, transparent, inherits colour. On hover: a hot fill with ink.

### Tabs — `.al-tabs`
Equal-width cells, label-size mono caps (500, +0.08em), with a 3px rule
underneath. The active tab inverts. There is no underline indicator and no
pill.

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

### Interaction model

| Meaning | Treatment |
|---|---|
| Pointing at | Hot fill + ink (buttons, toolbar), or blush/ember (rows) |
| Pressed / selected / active | Inversion (`--border` / `--bg`) |
| Current / the one that matters | Hot fill + ink, weight 500 |
| Needs a decision | Hot band (banner) |
| Unsaved / pending | 7px hot square |
| Keyboard focus | 2px `--accent` outline, offset 2px *(export addition, see §12)* |

---

## 7. Content: how markdown renders

These are the rules behind `.al-prose`, taken from the editor's decoration
layer.

| Element | Treatment |
|---|---|
| **Headings** | See §3.3. h1–h4 are display caps; h5–h6 are mono. |
| **Strong** | Archivo 600 with a 3px hot underline *behind* the text (inset shadow). |
| **Emphasis** | Italic. Nothing else. |
| **Strikethrough** | 2px line, text drops to `--text-muted`. |
| **Inline code** | A solid `--accent` chip with `--on-accent` text, mono 0.88em, padding 0.05em 0.3em. Square. |
| **Link** | A hot chip with ink text, padding 0 0.2em, **no underline**. Hover inverts *(export addition)*. In the app, links open with ⌘-click. |
| **Horizontal rule** | A 6px solid bar. |
| **Blockquote** | An 8px slab on the left, 1em gap, Archivo Black caps at 1.05em, leading 1.35. Never a `>`. Never italic. |
| **Bullets** | Square glyphs in `--accent` at 0.8em, hung in a 1.6em gutter: `▪` at even depths, `▫` at odd. |
| **Ordered lists** | Mono 500 numbers in `--accent` at 0.85em, hung in the same gutter. (The 0.85em size and the hang come from PR #50.) |
| **Tasks** | Bullet, then a native checkbox with `accent-color: var(--accent)`. Done items go muted and are struck through. |
| **Code block** | A solid black slab, square, full measure, mono 0.85em, padding 0.5em 1em. The language is set top right in hot mono caps, 0.7rem, +0.16em. |
| **Table** | Mono 0.85em, 2px ink cell borders, head row inverted in caps (+0.12em, 500). A cell containing **bold** fills entirely with hot, because a chip floating inside a cell reads as a mistake. |
| **Image** | Inline with the text (`inline-block`, middle-aligned), at most the measure wide and `60vh` tall, with a 3px `--border` rule around it. (From PR #42.) |
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
black is free and the orange would land as a muddy mid-grey.

- The page is white, not cream, because cream dithers to a full-page grey.
- Everything orange turns black.
- **Slabs stay solid.** The code well stays black with white text, and the
  table head and bold cells stay black with white text. Backgrounds are
  forced with `print-color-adjust: exact`.
- **Inline runs are ruled, not filled.** Solid black is hard to read at body
  size, so links get a 2px underline offset 2px, and inline code gets a 1px
  box.
- Code colours collapse to white and greys (`#d0d0d0` strings, `#b0b0b0`
  comments and operators). Italic comments carry the distinction that colour
  used to.
- Chrome is hidden. Focus-mode dimming is cancelled. Headings never end a
  page, and tables don't split.
- Page margins: 18mm top and bottom, 16mm left and right (`@page`). That is
  the one rule in `alethia.css` that cannot be scoped to an element, so it
  applies to whatever page is being printed.

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

### App icon (`assets/alethia-icon.svg`)
A hot orange tile (`#ff3b00`, macOS mask `rx=224` on 1024), with a 36px ink
rule inset 64px that follows the mask's corners, and a black Greek **α** set
in a serif. It's the editor's hot table cell, grown into a tile. The rule
stays inside the app-switcher mask, including at the corners.

### Wordmark
"ALETHIA" in Archivo Black caps, tracking −0.02em. Pair it with ἀλήθεια in
mono label size and muted colour when the name needs explaining. The bundled
Latin subset of DM Mono has no Greek, so the Greek line falls back to the
system monospace. Load the Greek subset if that matters.

---

## 12. Gaps between the app and this guide

The export fixes or extends a few things that the app does not do yet:

| Topic | App today | This guide |
|---|---|---|
| Inline code in dark mode | Fixed on `fix/dark-inline-code`: the app gains `--on-accent`, so dark inline code is ink on `#ff5722` (5.97:1). Before that it was paper (2.78:1). | Same |
| Keyboard focus | No visible focus style on chrome buttons | 2px `--accent` outline, offset 2px, on `:focus-visible` |
| Link hover | None (links open with ⌘-click) | Inverts to an ink band |
| Disabled button | Not used | Dashed 2px rule, muted text, no hover |
| Text-on-fill colour | `#111111` hard-coded per rule | `--on-hot` token |
| Unused tokens | `--panel`, `--panel-fg`, `--accent-ink` are defined but never read (the search panel is set on `--bg`) | Left out |
| Icons | Rounded caps, `rx=2` file corners: the one soft element in the app | Kept as-is; if you redraw them, use square caps and miter joins |
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
`data-lang` on the `<pre>`. GFM task lists, tables with `align`, and
highlight.js or Prism output are styled as-is.

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

### Design tools
Import `tokens.json` (W3C DTCG Format Module 2025.10). Colours are `srgb`
objects with a `hex` fallback; sizes are `{ value, unit }` in `px` or `rem`.
DTCG has no `em`, so values the CSS sets in `em` (the content type scale,
letter-spacing, the list gutter) are plain `number` tokens under `font-scale`,
`tracking` and `size.list-gutter`: multiples of the element's font size. Semantic colours take
their light value as `$value` and carry the dark alias under
`$extensions["com.alethia.mode"]`, which importers may ignore.

### Slides, posters, social images
Use paper ground, one display-caps headline, mono caps for the kicker and
footer, a 6px rule, and at most one hot block. If it needs a second colour,
it needs less on it instead.

---

## 15. Don'ts

- Don't round a corner, add a shadow, blur, or gradient.
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
