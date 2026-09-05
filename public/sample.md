# Welcome to Markdown Reader

The markdown source is always here. Rendering is a skin the caret peels back --
click into anything below and its raw syntax reappears around just that node.

Open a file with **Cmd+O**, or a whole folder with **Cmd+Shift+O**.

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

| Column A | Centered | Right |
|:---------|:--------:|------:|
| one      | **two**  | 3     |
| four     | five     | 6     |
