<!-- Thread 3: Book without the AI model — rules write the story, your picture is the hero,
     the scenery follows the words, and the book saves as a video.
     GIFs 10–14 recorded by scripts/record-thread-3.mjs from the real page at phone size
     (headless Chromium, touch emulation, CPU only). No model is involved, so nothing is
     stubbed, but no clip claims a speed: it is not a phone. The drawing in 12 was made by
     the script, not a child. The video in 14 is WebM because this Chromium cannot encode
     H.264; Chrome and Safari make MP4. Every number below is in docs/story-rules.md. -->

1/
I took the AI out of my AI picture-book app 🧵

The small model's stories were never quite good enough. So now the page writes them with rules, draws every page, and opens with nothing to download.

Still all on your own device.

2/ [10-no-download.gif]
Pick a hero, where they live, what they wish for. Tap write.

No model, no download, no server. The privacy meter stays at 0.

It even works on phones that could never run an AI model.

3/
Why rules won:

With a lot of help, the 0.6B model's stories made sense 7 times in 8, and the hero went missing from pages.

A rule-written book can be checked. A test writes 7,800 of them and fails if any picture draws something its words don't say.

The hero is named on 192 of 192 pages.

4/ [11-own-story.gif]
Or write your own story, or paste one in.

The page splits it into pages, finds the hero ("Luna was a little cat…"), and shows what each page will draw before it draws it.

It never changes a word you wrote.

5/ [12-your-picture.gif]
The hero can be your own picture: a pet, a photo, or a child's drawing.

The paper is taken away, or a person cut out of a photo, all on your device.

It never goes in a share link: whoever opens it sees a drawn stand-in instead.

6/ [13-scenery.gif]
The backgrounds follow the words: farm, forest at night, snow, town, bedroom.

A place carries to the next page until the story moves on. "Wants to see the sea" doesn't put you at the sea 🙂

Art from Twemoji, plus Microsoft's Fluent Emoji.

7/ [14-video.gif]
Save the whole book as a video, or one page as a GIF, made on your own device.

MP4 where your browser can, WebM where it can't. Silent: a browser can't record your phone's voice.

8/
Bugs the new tests found that the AI version had all along:

• "lighthouse" was drawn as a light bulb
• "buses" were never drawn
• rivers and roads drew nothing

A story you can check beats a story you can only read.

9/
The AI isn't gone: Sketch mode still runs a small model in your browser, thanks to WebLLM 🙏

Try it: richardawe.github.io/sketchgpt
