<!-- Thread 4: Draw me (a photo as a moving drawing), Star in a book, and Film (a written
     scene as a short film, in three styles). No AI model in any of it.
     GIFs 15–19 recorded by scripts/record-thread-4.mjs: 15–17 are screen recordings of the real
     pages at phone size (headless Chromium, touch emulation, CPU only); 18–19 are the videos Film
     itself saved, cut to GIF. Nothing is stubbed, and no clip claims a speed: it is not a phone.
     The films were made at 360 px / 12 fps to keep the render short on a CPU (phones make
     720 px / 24 fps), as WebM (this Chromium has no H.264; the iPhone makes MP4).
     The headless browser has no voices, so Cast says "This browser has no voices" in 17.
     BEFORE POSTING: 15 and 16 use NASA's public-domain portrait of Kathleen Rubins
     (tests/fixtures). NASA's media rules say an astronaut's picture must not suggest
     endorsement — re-record them with your own photo:
       node scripts/record-thread-4.mjs --face me.jpg 15-draw-me 16-star-in-book
     The only phone numbers claimed are the owner's iPhone runs in docs/film-plan.md. Draw me,
     and Film's Realistic and Drawn styles, have not run on a phone yet; nothing below says they have. -->

1/
Two new things in my browser app 🧵

A photo of you becomes a moving drawing.
A scene you write becomes a short film.

No AI model in either. Nothing uploaded, no account, all on your own device.

2/ [15-draw-me.gif]
Draw me: pick a photo and the page draws you as a hand-drawn caricature that blinks and moves.

You choose how much caricature. Save it as a GIF, a sticker or an SVG.

The photo leaves the screen once it's drawn, and never leaves the device.

3/
The hard part was skin colour. Both obvious rules were wrong:

• the lit pixels drew a dark-skinned woman several shades lighter
• the whole face drew side-lit people near-black

It now leaves out only deep shadow. And a test fails if a nose, lips or eyes are ever exaggerated.

4/
Finding: MediaPipe's own JavaScript runtime sends usage stats to Google every 60 s.

No image data, but my rule is: use nothing that logs.

So I kept Google's face models (they're just weights) and run them on LiteRT.js instead. A test fails if any logging address comes back.

5/ [16-star-in-book.gif]
Then: Star in a book.

Your drawing becomes the hero of a picture book, on every page. Only the drawing goes across, and only for that tab.

Send the book as a link and your face stays behind: whoever opens it sees a drawn stand-in.

6/ [17-film-write.gif]
And for grown-ups: Film.

Write a scene in plain prose. The page finds the people, asks she/he/they, and shows what it understood: who says each line, and the lines it had to guess.

You pick the looks, the clothes and the voices.

7/ [18-film.gif]
Then it stages it in 3D: sets, light from the time of day, props in hand, the camera on whoever's speaking, subtitles, sounds from the story.

Your phone's voices read the lines as you watch.

Save it as a video, made on your device.

8/
Could a phone really render a 3D film in the browser? I measured first.

My iPhone made 2 minutes of 720p video with sound in 43 seconds, faster than real time.

I'd planned for a struggle: few people, cheap light, a render that could survive a crash. None of it was needed.

9/ [19-film-styles.gif]
One film, three styles:

• Stylised: two free CC0 bodies, with clothes made on the page
• Realistic: Microsoft's Rocketbox people. Jaws move, eyes blink
• Drawn: Open Peeps, ink on paper, no 3D at all

Same story, same camera, same cuts.

10/
Rules on real writing: I ran 490 passages of Doyle, Joyce, Chekhov and co through it.

63% of action verbs get acted.
Half the dialogue has no clear speaker: classic prose leaves that to context.

So the page marks its guesses instead of hiding them. Tap to fix.

11/
Share a film as a link: whoever opens it makes the same film on their own device. Or download it as a screenplay.

Draw me: richardawe.github.io/sketchgpt/selfie.html
Film: richardawe.github.io/sketchgpt/film.html

(Sketch mode still runs a small model in your browser, thanks to WebLLM 🙏)
