# Welcome to Alethia

The markdown source is always here. Rendering is a skin the caret peels back --
click into anything below and its raw syntax reappears around just that node.

Open a file with **Cmd+O**, or a whole folder with **Cmd+Shift+O**.

## A night at the observatory

A fictional observing plan, with a little room for ambition. Left-aligned names,
centered filters, and right-aligned numbers keep a bigger table easy to scan.

| Target | Filter | Frames | Each | Total | Status |
|:-------|:------:|-------:|-----:|------:|:-------|
| **The Moon** | Clear | 12 | 5 s | 1 min | Ready |
| **Orion Nebula** | RGB | 24 | 30 s | 12 min | Ready |
| *The Pleiades* | Blue | 30 | 45 s | 22.5 min | Stacking |
| **Andromeda** | RGB | 36 | 60 s | 36 min | Stacking |
| Lagoon Nebula | H-alpha | 24 | 75 s | 30 min | Planned |
| Eagle Nebula | H-alpha | 32 | 90 s | 48 min | Planned |
| Veil Nebula | O-III | 40 | 120 s | 80 min | Planned |
| Horsehead Nebula | H-alpha | 48 | 150 s | 120 min | *After midnight* |

Click a cell to edit its Markdown. Press **Tab** to move between cells, then
click this paragraph to see the table render again.

> Keep the notes as carefully as the images. Tomorrow's best discovery might
> start with something you almost overlooked tonight.

## Inline formatting

This paragraph has **bold text**, *italic text*, ~~strikethrough~~ and some
`inline code`. Here is an escaped \*not italic\* pair, and a [link to
example](https://example.com).

### Third-level heading

Click into any of the styled runs above and the raw markdown reappears around
just that node. Move the caret away and it renders again.

#### Fourth level
##### Fifth level
###### Sixth level

## Code

```ts
interface Document {
  path: string | null
  content: string
}

function isDirty(doc: Document, saved: string): boolean {
  // Keyword, string and comment colours come from the highlight style.
  return doc.content !== saved
}
```

```python
def word_count(text: str) -> int:
    return len([w for w in text.split() if w])
```

## Structure

> A blockquote, which should show a left rule
> and no visible angle brackets.

- A bullet list item
- Another item
  - A nested item
    - A third level

1. Ordered item one
2. Ordered item two

- [ ] An unchecked task
- [x] A completed task

---

## A little mathematics

For equal exposures with independent noise, stacking $N$ images improves the
signal-to-noise ratio by a factor of $\sqrt{N}$. Sixteen frames give a factor of four:

$$
\mathrm{SNR}_{N} = \sqrt{N}\,\mathrm{SNR}_{1}
$$

Click the equation to reveal its source; click the text around it to render it again.

## Keep exploring

The repository's `public/examples` folder has two more documents. Open that folder
with **Cmd+Shift+O**, then choose a file in the sidebar:

- **formula-notebook.md** — fractions, sums, matrices, integrals, and aligned equations.
- **project-notes.md** — front matter, a project board, checklists, nested notes, and code.
