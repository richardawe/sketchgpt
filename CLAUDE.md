# sketchgpt — continuation brief

Read this first. It is the state of the project, the things that cost time to
learn, and the conventions that hold here.

**What this is:** the first shipped project of a one-person AI lab, built in
public on X. The lab's thesis is at the bottom.

---

## Live now

| | |
|---|---|
| Site | https://richardawe.github.io/sketchgpt/ |
| Repo | https://github.com/richardawe/sketchgpt (public, template enabled) |
| Default branch | `main` — deploys automatically on any push touching `web/` |

```
web/browser.html          in-browser inference (WebGPU via WebLLM) — the public page
web/index.html            local chat against Ollama — development only
web/sketch.mjs            sketch format, context budget, SVG rendering
web/stamps.mjs            generated Lucide path data — never edit by hand
web/rough.mjs             vendored rough.js 4.6.6 (MIT) — verbatim, keep it so
scripts/setup-pages.sh    push, enable Pages, deploy, print URL (needs the user's gh)
scripts/setup-ollama.sh   install Ollama, pull the pinned model, verify, smoke-test
scripts/serve-web.sh      serve web/ on localhost
scripts/build-stamps.mjs  regenerate web/stamps.mjs from Lucide
scripts/token-budget.mjs  measure sketch cost against Qwen3's real tokenizer
scripts/sketch-bench.mjs  run the real prompt through real models, judged by the real parser
scripts/vram-probe/       measure what a model really allocates (no GPU needed)
models/model-pin.json     exact layer digests for reproducible weights
docs/customising.md       what small models can and cannot do, with measurements
docs/mobile-models.md     the phone-suitable models WebLLM ships, and the plan to add them
docs/roadmap.md           the six-month plan
```

---

## Measured findings — do not re-derive these

All from real runs in-session. `smollm2:360m` in Ollama is **F16**; the browser
serves **4-bit**, and that gap explains most surprises.

| Finding | Detail |
|---|---|
| **Obedience beats capability** | Journal-entry sentiment: SmolLM2-360M **10/10**, Llama-3.2-1B **4/10**. The 1B lost by answering "good", "downward", "anxious" when asked for one of two words. |
| **Valid ≠ correct** | A grammar constraint (`root ::= "positive" \| "negative"`) guarantees well-formed output, not right output. At 4-bit the logits carry little signal, so it returns the same label every time. The mood tagger shipped, said "positive" to everything, and was deleted. |
| **4-bit wrecks instruction-following** | The academic literature agrees; sub-1B degrades hardest. Free generation breaks; this is why open chat read as gibberish on the phone. |
| **Task shape decides safety** | Tasks with a correct answer (classify, extract, route) fail **silently** — confident, well-formed, wrong. Tasks without one (describe, riff, open questions) degrade to merely **mediocre**, which is visible. Only ship the second kind at this size. |
| **Small models need a seed** | Given concrete input they produce usable lines. Asked to generate from nothing, or to follow a multi-part format, they waffle or echo the input back. |
| **`vram_required_MB` is advisory, and sometimes wrong** | **Nothing in WebLLM reads it** — zero property accesses in 0.2.85. Measured load-time allocation: SmolLM2-360M 574 MB vs 580 published (1% out), Llama-3.2-1B 1064 vs 1129 (6%), **Qwen3-0.6B 1342 vs 1925 (43%)**. The gap is MLC's planned workspace for `batch_verify` (706 MB on Qwen3-0.6B), a speculative-decoding function whose name appears nowhere in WebLLM. It is never bound and never allocated. |
| **Allocation is a formula, and it is linear in context** | `params + (2 × layers × kv_heads × head_dim × dtype_bytes) × ctx + ~23 MB`. KV dtype follows the build suffix — f32 in `q4f32`, f16 in `q4f16`. Verified by measurement on three models × four context lengths, then used to predict Llama-3.2-1B to within 1% before measuring. `params` and the KV geometry come from the `_metadata` blob inside the compiled wasm. |
| **Qwen3-0.6B fits a phone** | ~476 MB at 1024 context, ~828 MB at 4096 (q4f16, predicted from the measured formula). It was excluded by a published figure three times the truth. Download is only 352 MB. |
| **Attention shape beats parameter count** | KV per token at f16: Qwen2.5-0.5B 12 KiB, Qwen3-0.6B 112 KiB, SmolLM2-1.7B 192 KiB. Gemma 3's sliding window pins its cache at 512 tokens whatever the context. Qwen3.5 is **hybrid** — `kv_state_kind: "hybrid"`, only 6 of its 24 layers hold a KV cache, the other 18 are linear-attention. Full table in `docs/mobile-models.md`. |
| **fp32 builds are a free fallback** | `SmolLM2-360M-q4f32_1` and `-q4f16_1` download **byte-identical** shards. The suffix changes activation precision, not weight storage — fp32 costs GPU memory (376 published f16 vs 574 measured f32), not bandwidth. It also doubles KV dtype. |
| **Desktop changes everything** | Qwen3-1.7B (2037 MB) produced a genuine multi-chapter book outline. The ceiling above belongs to 360M-class models on phones, not to the page. |
| **A digit is a token, and so is the space before it** | Qwen3 tokenizes `" 160"` as four tokens — `" "`,`"1"`,`"6"`,`"0"`. In any structured output, **the numbers are the cost and the syntax is a rounding error**. Shortening `rectangle` to `r` across ten sketch commands saved 0 tokens; moving the grid from 0–400 to 0–100 saved 19%. Measured with Qwen3-0.6B's real tokenizer via `scripts/token-budget.mjs`. |
| **Move the shape into the page, not the model** | A stamp — `house 25 55 40`, a noun plus three numbers — costs 13 tokens and draws a recognisable house from bundled Lucide path data. Drawing the same house from primitives costs 5 commands and looks worse. One scene: 235 tokens as JSON objects → 66 as stamps, **3.6× cheaper and better**. Naming a noun is the easiest thing a small model does; composing a recognisable object from line segments is among the hardest. |
| **Enrichment is free if it needs no tokens** | rough.js redraws geometry the model already sent, so the hand-drawn look costs nothing at inference. Anything that makes output *prettier* belongs on the page; only what makes it *different* belongs in the prompt. |
| **A cheap format does not buy a good drawing** | First real-device run, Qwen3-0.6B on a phone, "draw a house beside a tree": **one circle**, and the title was the request echoed back. No dropped commands — so the model emitted almost nothing, valid. Adding a worked example fixed it: the next run produced real stamps. Making a drawing affordable and making a 0.6B model *compose* one are separate problems, and the second is bought with examples, not format. |
| **A worked example teaches its shape, not its rule** | With one example — two objects and a ground line — Qwen3-0.6B asked for "a house" drew **two houses and a ground line**. It copied the example's command count and filled both object slots with the only noun it had. The same applies to the title: the example's title has to show the imperative being stripped, or the model echoes "Draw a house" back as the caption. |
| **Two examples were not enough; the model must see the degenerate case** | After adding a second, longer example it *still* drew two cats for "a cat". Every shape it had been shown held at least two commands — including the empty template on the prompt's first line, `"c":["command","command"]`. **A small model does not infer that one is allowed; it has to see a one-command answer.** Count the slots in your template, not just your examples. |
| **State the rule and show it — neither alone worked** | "The number of commands follows the request" plus two examples still duplicated. What the prompt now carries is both an explicit rule ("Draw each thing once. One cat is one command.") and a one-command example. Each iteration cost a round trip to a real phone; nothing here was visible from a mock. |
| **Naming is the easy half; placing is the hard half** | With the duplication fixed, Qwen3-0.6B returned three *correct* nouns for "a house with a tree and a car" — and put them all at x=50, y=50/52/54. It had anchored on an example's coordinates and added 2 each time. **Arithmetic is what a 0.6B is worst at, and it is the one thing the page can simply do instead.** `spreadStamps()` separates stamps that have collapsed, keeping the order the model listed them in, and leaves a deliberate overlap (a sun behind a cloud) alone. Fixed in code, verified against the exact output the phone produced — no round trip needed. |
| **Four prompt rounds, then the page** | Duplication took three prompt iterations and a phone trip each; layout took one code change tested in seconds. The rule that keeps paying: **if the page can compute it, the prompt should not ask for it.** Prompt tokens also cost the phone its output budget — 197 → 391 across those rounds took a 1024-context phone from 437 output tokens to 299. |
| **Bigger models compose better; no model places better** | Same prompt, same parser, Ollama on CPU (`scripts/sketch-bench.mjs`), six requests: **Qwen3-0.6B 14 commands / 13 distinct nouns / 8 of 10 requested things drawn; Qwen3-1.7B 62 commands / 19 nouns / 9 of 10.** The 0.6B retrieves rather than composes — "draw a birthday party" came back as `cat, sun, bird, bird, sailboat`, which is both examples regurgitated verbatim. The 1.7B invents a scene. But **both piled stamps up on exactly 2 of 6 drawings**: scale buys vocabulary and coverage, not arithmetic. `spreadStamps()` is load-bearing at every size. |
| **Colour is one word, and both sizes can use it** | `house 25 55 40 red` — a colour name is one token where `#c0392b` is seven, and the page owns the values so the model cannot invent an unreadable one. Measured: zero invalid colour words from either model, and neither adds colour unasked. The 1.7B handles "a yellow sun over a blue sea" (`sun … yellow \| sea … blue`); the 0.6B reached for `label 40 50 blue` instead — the label trap door again, on the weaker model. Taught only at ctx ≥ 2048, so a phone pays nothing for it. |
| **`label` is a trap door out of the drawing** | Listed plainly among the tools, the model reached for `label 35 55 cat` instead of `cat 35 55 30` — printing the word rather than drawing the thing, on the same request that had worked a minute earlier at temperature 0.2. It is now described as being for words written *on* the picture, never for naming something drawable. |
| **The page was throwing away the only evidence** | That one circle is indistinguishable from a misparse without the model's raw output, and nothing in the UI showed it. Anything shipped to a device nobody here can reach needs its raw output one tap away, or every report is a guess. |
| **A chat history of drawings is unbounded and does not need to be** | Sketch history grew by a whole drawing per turn. Carrying only the previous drawing and the instruction that produced it makes the prompt **O(1) in turns** — measured flat at 391 tokens from turn 2 onward at 4096, 2048 and 1024 context. A revision needs a seed, not a transcript. |

### Browser gotchas already fixed

- `navigator.gpu` can exist while `requestAdapter()` returns **null** (headless,
  GPU-less VMs, blocklisted drivers). Check for an adapter, not the API.
- **Running into the context window fails two different ways, and one is
  silent.** If the prompt alone passes the window WebLLM throws
  `ContextWindowSizeExceededError`. If the prompt fits but generation reaches
  the edge, it just stops: `filledKVCacheLength == contextWindowSize` sets
  `finishReason: "length"` with no error, which for structured output means
  truncated JSON that reads as "the model failed". Never ask for more
  `max_tokens` than the room actually left.
- **WebLLM 0.2.85 accepts a full EBNF grammar, not only a JSON schema.**
  `response_format: { type: "grammar", grammar: "…" }` reaches XGrammar's
  `compileGrammar`; `json_object` reaches `compileJSONSchema`. A terse
  line-based DSL was measured at only ~5% cheaper than the same lines inside a
  JSON envelope, so sketch mode keeps `json_object` — the proven path — and
  validates the line format itself. The grammar route is there if a format ever
  justifies it.
- **Truncated structured output is worth salvaging, not discarding.** Running
  out of tokens strands valid commands inside unterminated JSON. `salvage()`
  pulls the complete strings out and the sketch renders as far as it got,
  captioned as unfinished — the same instinct as `balanceBraces()`.
- Exceeding device memory **kills the tab** — no catchable error. Prevention is
  the only defence: budget with headroom, never ship a default near the limit.
- `q4f16` builds need the `shader-f16` adapter feature. Without it they are
  guaranteed to fail, so filter them out.
- Qwen3 chat templates **prefill the opening `<think>` tag**, so the stream
  carries only the closing `</think>`. Parsing for an opening tag dumps the
  whole monologue into the answer.
- Browser storage quota can be smaller than the model; the download then dies
  partway. Compare quota against the requirement before starting.
- **`gemma3-1b-it-q4f16_1-MLC` could not load** — its config sets
  `sliding_window_size: 512`, the prebuilt record overrides
  `context_window_size: 4096`, and WebLLM throws `WindowSizeConfigurationError`
  when both are positive. Fixed by `chatOptsFor()` passing
  `sliding_window_size: -1`. The seven Mistral records clear it themselves;
  gemma3's does not, so check this for any new model with a sliding window.
- **`max_history_size` is RNN state, not chat history.** It is consumed in
  exactly one place — `create_rnn_state`. Qwen3.5 sets it to 1 because it is a
  hybrid attention model, not because it forgets your conversation. (An earlier
  draft of `docs/mobile-models.md` got this wrong.)
- **`required_features` is not a reliable fp16 filter.** Only 29 of 163 prebuilt
  records declare it; 54 models with `f16` in the id do not, including
  `gemma3-1b-it-q4f16_1` and every Qwen3.5 build. The page's regex is the more
  correct filter — keep it.
- **Models emit Markdown and LaTeX whether or not you ask.** A plain-text pane
  shows raw `**bold**` and `\frac{}{}` and reads as broken. `renderMarkdown()`
  handles both; KaTeX loads lazily from the CDN only when a message contains
  maths, and falls back to source text if it cannot be fetched.
- **`$…$` cannot be detected by a whitespace rule.** Models routinely pad the
  delimiters — `$ \frac{a}{b} $` — so requiring non-space inside them silently
  drops real formulas. `isFormula()` judges the *content* instead: LaTeX markup,
  or short plain algebra containing an operator. That keeps "$5 and $10" as
  prices.
- **`white-space: pre-wrap` doubles the line breaks** once a message is rendered
  as Markdown, because the markup already carries them. The `.rich` class
  switches it off; plain text and user messages keep it.
- **`height: 100vh` puts the composer below the fold on a phone.** On mobile
  `vh` is the viewport with the URL bar *hidden*, so the footer only appeared
  after dragging the page. `100dvh` (with `vh` as fallback) tracks the visible
  area. `interactive-widget=resizes-content` in the viewport meta keeps it above
  the on-screen keyboard.
- **`rows="1"` clips a placeholder that wraps.** The composer's
  "Enter to send, Shift+Enter for newline" hint needed two lines at every phone
  width and was cut in half. Measure the fit **while the element is visible** —
  a `display:none` element reports `scrollHeight` 0, so a startup check always
  says it fits.
- **"Cannot fetch <url>" is a STORAGE error, not a network one.** WebLLM's
  `fetchWithCache` raises it when `cache.add()` resolves but the entry is not
  in the cache afterwards. It usually names `mlc-chat-config.json`, a 2 KB
  file, which makes it read like a dead URL — the URL is fine. Causes: a full
  or capped store, private browsing, or a browser that silently evicts.
  `pickCacheBackend()` probes the Cache API at startup and falls back to
  WebLLM's `cacheBackend: "indexeddb"`; a failed load also offers a one-tap
  retry on the other backend. The two backends cannot see each other's
  weights, so switching means downloading again — never do it silently.
- **A failed load must not destroy the card.** `fail()` replaces `#wrap`, which
  removed the model picker and the load button and left a reload as the only
  way forward. Load failures use `failSoft()` instead, which appends the error
  and keeps the controls.
- **iOS zooms the page when a focused form control is under 16px.** `font:
  inherit` on the composer resolved to the body's 15px, so tapping it magnified
  everything and clipped the header and the answer text on the right. It looks
  exactly like horizontal overflow and is not — nothing is overflowing, the page
  is magnified. `@media (pointer: coarse) { … font-size: 16px }` stops it.
  **Chromium does not auto-zoom, so emulation will never catch this.**
- **`$v$` is the commonest inline formula and has no operator to detect.** A
  content rule built around operators drops single symbols. `isFormula()` also
  accepts a lone short identifier, letter-first so "$5" stays a price.
- **Small models drop closing braces.** `\frac{\Delta t}{\sqrt{1 - v^2/c^2)}`
  came out of a real answer. `balanceBraces()` closes what is open and retries;
  only then does it fall back to source text. Do **not** use KaTeX's
  `throwOnError: false` — its red error styling blames the page for what the
  model got wrong.
- **A bare `###` is how a truncated answer ends.** It is not a heading and not
  prose; the renderer drops empty headings rather than printing them.
- A `file://` page sends a null origin and Ollama rejects it — the local page
  must be served.
- A constrained preset that persists across reloads must be **visible**, or the
  next session looks broken while behaving exactly as configured.

---

## Environment walls hit (all real, all cost time)

**GitHub, from this sandbox:** pushing commits works. These do not, and need a
human click:

1. A workflow's `GITHUB_TOKEN` **cannot create** a Pages site —
   *"Resource not accessible by integration"*. Hence `setup-pages.sh` runs
   locally with the user's own credentials.
2. The `github-pages` environment pins its allowed deploy branch at creation
   and **does not follow** a later default-branch change. Deleting the
   environment makes GitHub recreate it against the current default.
3. `PATCH /repos/...` (description, template flag, default branch) →
   *"Repository settings writes are not permitted through this proxy."*
4. Deleting a remote ref → blocked over git **and** over the API.

**Ollama on CPU works in this sandbox** — so quality claims no longer have to
wait for the user's device. Two gotchas: the installer needs **zstd** and does
not pull it in (`apt-get install -y zstd` first, exactly as `setup-ollama.sh`
does), and `OLLAMA_MODELS` must point somewhere with room. On 4 CPUs,
`qwen3:0.6b` answers a sketch prompt in about 1 s and `qwen3:1.7b` in 2–7 s,
which is fast enough to iterate on a prompt without a phone in the loop. The
quantisation differs from the browser's (GGUF Q4_K_M vs MLC q4f16), so this
measures composition, not the exact bytes a visitor gets — say so in any claim.
`scripts/sketch-bench.mjs` is the harness.

**Machine:** no GPU here — but that is not the same as no WebGPU. Chromium with
`--enable-unsafe-webgpu` serves a real adapter through SwiftShader, and models
**load** under it, which is enough to measure allocation and to catch a model
that cannot load at all (see `scripts/vram-probe/`). What SwiftShader cannot do
is **generate**: a single token did not complete in 25 minutes at any prompt
length. So quality and throughput claims still come from Ollama on CPU or from
the user's own device. The user's machine is also CPU-only, which rules out
practical fine-tuning.

---

## How to work here

- **Test before shipping, and say what was not tested.** Nearly every bug in
  this project was found by the user, not by testing: the phone crash, the
  gibberish, the stuck preset, the leaked reasoning, the always-positive
  classifier. Emulation did not substitute for real hardware. Name the gap.
- **Verify claims before making them.** "Nobody has this" was wrong twice —
  in-browser LLMs have shipped since 2023 (WebLLM runs chat.webllm.ai), and
  quantization effects on small models are well covered in the literature.
  Search first.
- **Credit WebLLM.** It does the actual inference. Saying so first removes the
  "this already exists" reply as a gotcha.
- **Prefer deleting a feature to shipping a confidently wrong one.** The mood
  tagger deletion is more credible than the app.
- Playwright: use `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` with
  `--no-sandbox`; never run `playwright install`. The proxy CA blocks loading
  live HTTPS pages in Chromium — fetch with curl and serve locally instead.

---

## Open threads

- **Sketch mode works on a real phone.** Four rounds on the user's device got
  there: one circle → two houses → two cats → three correct nouns stacked in
  one spot → readable. What is confirmed working: stamps resolve, rough.js
  renders, "Show commands" reports, the page spreads a collapsed pile. What is
  still unknown is everything past the simplest request — nothing harder than
  "a house with a tree and a car" has been tried, and no other model has been
  tried at all.
- **Bigger desktop models are worth offering, and the page does not.** The
  desktop default is still Qwen3-0.6B (~500 MB) while Qwen3-1.7B draws 4x the
  commands and covers more of the request. Changing the default trades a
  500 MB download for ~2 GB, which is the user's call, not a silent one.
- **Nothing above 1.7B has been tried**, and no non-Qwen model at all. The
  bench takes any Ollama tag, so this is an afternoon's work, not a mystery.
- **The stamp vocabulary is a guess.** 133 Lucide icons and 84 aliases chosen
  by imagining what a model would say. The right way to size it is to log the
  nouns real models emit and see what misses; until then unknown nouns fall
  back to a label, which is visible rather than silent. Real models do reach
  for stamps: house, tree and car all resolved first time on the phone. Nothing
  outside that handful has been observed.
- **rough.js is confirmed working on the phone** since it was vendored — the
  hand-drawn wobble is visible in the screenshots. Whether the earlier CDN
  import was the cause of the smooth circle was never established, and no
  longer matters.
- **`setup-pages.sh` has never run end to end.** Guards, branch rewrite and the
  missing-`gh` path are verified; a real `gh repo create` is not. First real run
  is the test.
- **Old branch `claude/ollama-base-model-setup-hg1iuk` still exists remotely.**
  Strictly behind `main`, nothing unique on it. Needs a manual delete.
- **Repo topics not set** — `llm webgpu local-llm browser github-pages webllm`.
- **Stages 0–2 of `docs/mobile-models.md` are done and live.** The page budgets
  from the measured formula, passes `chatOpts`, picks a context rung per device,
  and offers 15 models in three tiers. **Stages 3–5 remain** — steady-state
  measurement, the 135M-f16-vs-360M-4-bit comparison, and embedding
  co-residency.
- **Stage 3 is now partly unblocked.** Qwen3-0.6B has loaded *and generated* on
  the user's phone, so the measured formula has its first fp16 confirmation.
  `scripts/vram-probe/` takes `&gen=1` to capture the first-inference workspace
  on real hardware; that was impossible under SwiftShader.
- **Four phone-capable models where there was one.** At a 900 MB budget:
  SmolLM2-135M-q0f16, SmolLM2-360M-q4f16 and **Qwen2.5-0.5B-q4f16 all at a full
  4096 context**, Qwen3-0.6B at 1024. Qwen2.5-0.5B is the surprise — 296 MB
  download against a published 945 MB that excluded it outright.
- **`gemma3-1b` misses a 900 MB phone budget by 44 MB**, flat at every context
  rung because its sliding window caps the cache. Worth re-checking once the
  steady state is measured — the margin is inside the error bar.
- **Steady-state allocation is still unmeasured.** The figures are load-time
  floors: `batch_prefill` and `batch_decode` allocate on first inference, which
  SwiftShader could not reach. Budget against floor + that workspace (42 MB
  SmolLM2, 92 MB Llama-3.2-1B, 162 MB Qwen3-0.6B, 410 MB Qwen3.5-0.8B) until a
  real device says otherwise.
- **RAG never started.** No GPU needed, so it is the realistic next capability.
- **Two X threads are drafted** but unposted (in session history): a
  measurement-led one and a user-benefit one covering device detection,
  privacy, formula rendering and storage control.

---

## The lab's thesis

> The research on small models is locked in PDFs, measured on GSM8K, and says
> nothing about whether *your* device can run *your* task. Every project here is
> a page someone opens on their own device that answers a question about their
> own situation.

Not "I invented browser AI." The differentiator is honest measurement and
distribution, not novelty. See `docs/roadmap.md`.
