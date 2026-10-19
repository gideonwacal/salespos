# SalesPos — 40-second vertical ad

`salespos-ad.html` is the advertisement, animated in a browser at 1080×1920 so
it can be screen-recorded into an MP4. It plays on open and runs for exactly
40 seconds.

It is **picture only**. There is no voice-over and no music in the file — both
are below, ready to record and lay over the capture in any editor.

## Recording it

1. Open `salespos-ad.html` in Chrome, full screen, on a display at least
   1920px tall. If your screen is shorter the stage scales down and you will
   capture less than 1080×1920 — see *Getting true 1080×1920* below.
2. Click **Hide controls**. The replay button and timer disappear and the film
   restarts from zero.
3. Record the stage area:
   - **QuickTime** — File → New Screen Recording → drag a box around the stage.
   - **OBS** — Display Capture, then crop to the stage. Set the canvas to
     1080×1920 and the output to 30 or 60fps.
4. Stop at 40 seconds. Trim the first and last few frames in your editor.

### Getting true 1080×1920

Most laptop screens are not 1920px tall, so the stage is scaled to fit. Two
ways round it:

- **OBS browser source**: add a Browser source pointing at the file, set width
  1080 and height 1920. OBS renders off-screen at full size regardless of your
  display.
- **Chrome device toolbar**: F12 → device toolbar → set a custom device of
  1080×1920 at DPR 1, then capture the viewport.

## Voice-over script

A confident, calm male voice — a technology advertisement, not an
announcement. Natural pauses at the line breaks. Roughly 95 words, which lands
around 38 seconds at an unhurried pace, leaving air at the end.

| Time | Line |
|------|------|
| 0:00–0:05 | "Running a business shouldn't mean guessing where your money went." |
| 0:05–0:12 | "SalesPos gives you a clear view of your sales — in real time." |
| 0:12–0:20 | "Track your stock, and know what needs attention before it becomes a problem." |
| 0:20–0:29 | "See your revenue, your expenses, and your profit — in one place." |
| 0:29–0:35 | "And keep an eye on your business wherever you are." |
| 0:35–0:40 | "SalesPos. Know your business. Grow your business." |

Leave a beat of silence between 0:34 and 0:35 — the cut to the brand frame
lands better with air in front of it.

## Music

Modern technology-commercial bed: soft pulse under the opening, a lift at
0:12, fullest through the profit scene at 0:20–0:29, and a clean resolve on
the brand frame. Duck it 8–10 dB under every voice line.

Royalty-free sources that fit: Epidemic Sound "Corporate Technology",
Artlist "Inspiring Product", or the Uppbeat free tier (attribution required on
the free plan — check before posting).

## What is on screen

| Scene | Time | Shows | Text |
|-------|------|-------|------|
| 1 | 0–5s | Hook, word by word | DO YOU KNOW HOW MUCH YOUR BUSINESS MADE TODAY? |
| 2 | 5–12s | Dashboard, sales dropping in, totals climbing | TRACK EVERY SALE → IN REAL TIME |
| 3 | 12–20s | Stock list, a count falling, low-stock alert | CONTROL YOUR STOCK → KNOW WHAT'S RUNNING LOW |
| 4 | 20–29s | Revenue, expenses, profit; profit called out | REVENUE ≠ PROFIT → KNOW YOUR REAL PROFIT |
| 5 | 29–35s | The same figures on a phone, slow orbit | YOUR BUSINESS. IN YOUR HAND. |
| 6 | 35–40s | Brand frame | SALESPOS · SALES • STOCK • PROFIT • CONTROL · TRY SALESPOS TODAY |

Every figure shown is the kind the app really produces, and every feature
named is one that exists. Nothing in the film is invented.

## Changing it

The copy is plain HTML near the bottom of the file, one `<section>` per scene.
Scene boundaries are the `SCENES` array in the script — adjust those and the
film re-times itself. Colours are SalesPos's own tokens, at the top of the
stylesheet.

## Using real screen recordings instead

The interface in the film is rebuilt from the app's own design tokens rather
than captured, so it stays sharp at any size and needs no live data. If you
would rather use genuine captures:

1. Start the demo at the sign-in page, pick a trade, and record the real
   dashboard, inventory and reports pages at 1080×1920.
2. Drop those clips into scenes 2, 3 and 4 in your editor, keeping the
   on-screen text and timings from this file.

That is the usual path for a final paid ad. This file is the storyboard,
the timing and the typography — ready to cut against.
