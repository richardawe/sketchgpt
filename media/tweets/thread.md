1/
I'm a one-person AI lab 👋

The goal: useful apps that run on small AI models living on *your* phone or laptop. No servers, no API bills, nothing leaves your device.

Here's what I've built, what I binned along the way, and what finally stuck 🧵

2/
Since my last post I've deleted more than I've shipped 😅

First to go was a mood tagger. It said "positive" to everything. Tiny 4-bit models are confidently, neatly wrong on anything with a single right answer.

3/
Then open chat: pure gibberish on phones.

Then "ask your documents": the small model made up answers to 3 of 5 questions the doc didn't even cover. Asking it to quote its source made it worse.

Both binned.

4/
Then Desk: brain dump → to-do list, plus "say it better" for your messages.

Useful, and the page even checked the model's work. One early version turned "won't be ready Friday" into "will be ready Friday" 🙃

Still, it wasn't the thing.

5/
What did stick was sketch mode.

The model just names things ("house", "tree x3") and the page places them and draws them. Small models are great at naming and terrible at maths, so the page does the maths.

Stories + pictures was the obvious next step 👇

6/ [1-book.gif]
So: a picture-book maker that runs entirely in your browser.

Type an idea, a small AI writes a six-page story right on your device, and every page gets its own illustration.

No account, no server, no API key.

7/ [2-phone.gif]
And yep, it runs on a phone 📱

Qwen3-0.6B downloads once (352 MB), then writes the story on your phone's own GPU. The phone stories are simpler, and each picture is built from the words on its page.

8/ [3-network-off.gif]
Nothing you type leaves your device.

That little shield in the header counts every network request after the model loads. Here I switch the network off completely and write a whole book.

Still 0.

9/ [4-how-it-was-made.gif]
Small models cut corners, so the page keeps an eye on them 👀

On 4 of 6 pages, Qwen3-1.7B just copied the prompt's example (boat, lighthouse, crane). The page catches it, redraws from the story's own words, and tells you under the picture.

10/ [5-print.gif]
Print it, save it as a PDF, or download the whole book as one file.

Try it: richardawe.github.io/sketchgpt

Huge credit to WebLLM, which does the in-browser AI. Illustrations are Twemoji (CC-BY 4.0).

11/
Where can this go?

📚 bedtime stories with no signal
👧 kids making their own books, safely
🏫 classrooms: no accounts, no data collected
🎁 printed keepsakes with your kid as the hero

Next up: more languages, and a public map of what each device can really run.
