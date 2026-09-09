---
title: The midnight observatory
type: example
status: draft
tags:
  - field-notes
  - markdown
  - design
---

# The midnight observatory

**Field notes / Issue 01**

A fictional project notebook for a small team building a place to watch the sky.
Part plan, part lab book, part reminder to bring another sweater.

> **Working principle:** make the next observation easy to begin and impossible
> to lose.

## The board

| Workstream | Owner | Stage | Progress | Next move |
|:-----------|:------|:-----:|---------:|:----------|
| Site survey | Mira | Done | 100% | Archive the field notes |
| **Power & cables** | Jules | Done | 100% | Label both ends |
| Telescope mount | Rowan | Build | 80% | Check the balance |
| Camera pipeline | Sam | Test | 65% | Compare dark frames |
| Weather station | Mira | Test | 60% | Log a full night |
| Observation log | Jules | Draft | 50% | Try the template |
| Remote controls | Sam | Plan | 25% | Sketch the interface |
| First-light party | Everyone | Plan | 10% | Pick a clear evening |

## Before the first exposure

- [x] Choose a site with a clear view of the horizon.
- [x] Label the power supply and data cables.
- [ ] Balance the telescope with the camera attached.
  - [ ] Check the counterweight.
  - [ ] Leave slack in the USB cable.
  - [ ] Confirm the mount can turn freely.
- [ ] Take a test exposure.
- [ ] Write down what surprised us.

### What we learned

The ~~automatic everything~~ *one reliable step at a time* plan is working better.
A short checklist and a clear log beat a mysterious folder of `final-final-2` files.

1. Set up before sunset.
2. Focus on a bright star.
3. Capture a short test sequence.
4. Review the images before starting a long run.

### Questions for the next session

- Image quality
  - Are the stars sharp at the corners?
  - Does the focus drift as the air cools?
- Operations
  - Can someone new follow the checklist?
  - Is the recovery procedure written down?

## From a note to a small program

The observation plan can become plain data:

```json
{
  "target": "Orion Nebula",
  "filter": "RGB",
  "frames": 24,
  "exposureSeconds": 30,
  "notes": "Start with a short test sequence."
}
```

A little TypeScript calculates the planned exposure time:

```ts
interface Observation {
  target: string;
  frames: number;
  exposureSeconds: number;
}

function durationMinutes(plan: Observation): number {
  return (plan.frames * plan.exposureSeconds) / 60;
}

const orion = {
  target: "Orion Nebula",
  frames: 24,
  exposureSeconds: 30,
};

console.log(`${orion.target}: ${durationMinutes(orion)} minutes`);
// Orion Nebula: 12 minutes
```

And the same idea in Python:

```python
def exposure_minutes(frames: int, seconds: float) -> float:
    return frames * seconds / 60


for name, frames, seconds in [("Orion", 24, 30), ("Pleiades", 30, 45)]:
    print(f"{name}: {exposure_minutes(frames, seconds):.1f} minutes")
```

## Small details worth keeping

**Bold** for a decision. *Italics* for a thought. `Inline code` for an exact name.
An escaped \*asterisk\* when you mean the character itself.

For an external reference, try the [Markdown Guide](https://www.markdownguide.org/).
Hold **Cmd** while clicking a link to open it in your browser.

### Observation log

#### Session 01 — First light

The first image was a little soft. The second was better. By the third, everyone
had stopped talking and was looking at the same small patch of sky.

##### Follow-up

Keep the raw frames, record the settings, and change only one thing at a time.

###### One last note

Bring the sweater.

---

Use **Outline** to jump between headings. Save an edit, then open **History** to
look at the version it replaced. These notes are here to be played with.
