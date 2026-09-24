<!-- Thread 2: the picture books move, read aloud, travel as a link and can be edited.
     The GIFs replay real captured model output (scripts/demo-books/dog-phone.json,
     Qwen3-0.6B, written with the per-page shape prompt) at camera pace, so the
     thread makes no speed claim; keep it that way. Recorded with
     scripts/record-demo.mjs animated readaloud sharelink editbook.
     The read-aloud clip is silent (headless Chrome has no voices) and says so. -->

1/
Update on the picture-book maker 📚

The books now move, read themselves aloud, and can be sent to anyone as a link.

Still all on your own device: no server, no account, nothing uploaded 🧵

2/ [6-moving.gif]
The pictures move now.

The AI's job didn't change: it still just writes the story. The page knows it drew a dog, the sea, a house, so it animates them itself.

It even reads the words: "jumps into the water… swims" makes the dog leap in and swim. "Dreams of swimming" doesn't.

3/ [7-read-aloud.gif]
Tap Read aloud and your phone reads the book, highlighting each sentence as it goes.

I tried an AI voice first (Kokoro, 82M). In a browser it took ~3x longer to speak than to listen to, plus a 92 MB download. Binned.

Your phone's own voice: free, instant, works offline.

4/ [8-share-link.gif]
Share puts the whole book inside the link itself, so no server of mine ever holds your story. (Browsers never send the part after the # to a website.)

Whoever opens it gets the book redrawn on their phone, with no AI model to download. Even phones that could never run one.

5/ [9-edit.gif]
And you can edit everything.

Rename the hero once and every page follows. Turn the dog into a cat and every picture follows. Change a page's words and its picture redraws.

The rule I keep coming back to: the page corrects the AI, never you.

6/
The stories got better too.

I tested asking the AI to fix its own story (a "second pass"): 5/24 → 6/24. No help.

Giving it one line per page instead (home → problem → try → help → it works → ending): 15/24.

Small models can't fix their own work, but they can fill a shape.

7/
A bug worth owning up to 🙈

Every update to the offline cache also wiped the downloaded AI model, so people quietly re-downloaded hundreds of MB.

Found it while building this. Fixed, with a test.

Try it: richardawe.github.io/sketchgpt/?animate=1

Inference by WebLLM 🙏
