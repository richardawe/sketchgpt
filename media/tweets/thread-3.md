<!-- Thread 3: Draw me — a photo drawn as a moving caricature, and starring in
     your own picture book. Recorded with scripts/record-selfie.mjs (GIFs 10-14).
     - The drawings are the real page on a real photo, in the browser. The
       photo is a public-domain NASA portrait (tests/fixtures/face-rubins.jpg).
       Before posting, re-record with your own selfie — a real, recognisable
       person's caricature in a promotion reads as their endorsement:
         PHOTO=me.jpg node scripts/record-selfie.mjs --out media/tweets
       (then rename selfie-*.gif to 10-14 as below).
     - The book's story is real Qwen3-1.7B output (scripts/demo-books/seed.json),
       replayed by a stub at camera pace: no speed claim, keep it that way.
     - The hello clip is silent (headless Chrome has no voices) and says so. -->

1/
New: Draw me 🎨

Pick a photo, and your phone draws you as a moving, hand-drawn caricature. Then you can star in your own picture book.

Your photo never leaves your phone 🧵

2/ [10-draw-me.gif]
How it works: a small face model finds 478 points on your face and the shape of your hair.

Everything else — the ink, the watercolour, the blinking — is plain code on the page. No AI draws you. The model measures; the page draws.

3/ [11-caricature.gif]
A slider sets how much caricature, from a straight portrait to wild.

What it may exaggerate is fixed: head shape, eye size, brows, smile, hair.

Never nose width, lips, eye shape or skin tone. That's how caricature turns into stereotype. A test fails if it ever does.

4/ [12-say-hello.gif]
Every part of the drawing is a separate piece, so the page can move it: blink, glance, smile.

Tap Say hello and your phone's own voice speaks while the mouth moves. (This clip is silent.)

5/ [13-save-gif.gif]
Save it as a GIF, a sticker or an SVG, made on the phone and straight into your chats.

The exporter only ever sees the drawing, never the photo, so a GIF can't carry your photo or where it was taken.

6/ [14-star-in-a-book.gif]
Star in a book: the next story you write has you as the hero, on every page, blinking.

Only the drawing crosses over, and only in that tab. Share the book and the link just says "me": everyone else sees a stand-in, never your face.

7/
Two things I got wrong on the way 🙈

Google's face library quietly logs usage to Google. No photo, but still a request off your phone.

I kept the models, dropped the library, and run them on a plain runtime instead. A test fails if a logging address ever comes back.

8/
And skin colour.

Rule 1 drew a Black astronaut several shades lighter than she is. Rule 2 drew two side-lit people almost black.

Shipped: the middle of your skin's own colours, ignoring deep shadow, kept at exactly that lightness. Tested on 9 faces.

9/
Try it: richardawe.github.io/sketchgpt/selfie.html

The first photo downloads ~13 MB, once. It all runs on your phone.

Face models: MediaPipe, run by LiteRT.js (both Google, open source). Stories: WebLLM 🙏
