---
title: "Nudge & Nod — a daily check-in, answered any way they can"
published: false
tags: presagechallenge
---

*This is a submission for the [Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04).*

## What I Built

Nudge & Nod is a phone web app for carers and families. The person being checked in may speak easily, or they may not — some autistic people, some people after a stroke, some people with dementia, some people who are simply tired of being asked in words.

A nudge is the gentle daily ask. A nod is any answer: tapping a big picture, typing a few words, or sitting where the camera can see for about half a minute.

On the phone, Chrome shows a live preview, a camera-on indicator, and Stop. Frames go to a small Node server, which runs the official SmartSpectra Node SDK (`useCustomInput` / `sendFrame`) and sends pulse and breathing back as they settle. The family page does not compare anyone with a population. It says whether today looks like **their own** recent days, using a median and interquartile band you can read in a sentence. A one-page summary can be printed for a conversation with a care professional.

It is a web app because the person I had in mind has an Android phone and no laptop. SmartSpectra has no browser SDK, so the browser captures frames and the server, on Ubuntu-class glibc, runs the Linux SDK.

There is a clearly labelled sample house (`maple` / `2468`) and a sample check-in that never opens the camera, so the whole product can be walked when a key or a camera is not available.

Nudge & Nod is not a medical device. It does not diagnose, treat, or decide care.

## Demo

<!-- Replace with the unlisted or public YouTube / Drive link after you record on the phone. -->

Demo video: `TODO — record with the Android screen recorder. Script: DEMO_SCRIPT.md in the repo.`

Live app: `TODO — https://<your-service>.onrender.com after the Render deploy.`

Sample house, also printed on the welcome screen: house word **maple**, PIN **2468**.

## Code

<!-- Replace with the public GitHub URL. -->

Repository: `TODO — public GitHub link to this repo.`

Setup, the phone-only Render deploy, and the data-handling notes are in `README.md`.

## How It Responds to Human Signals

The live path is the main path. During a check-in the server constructs `SmartSpectraSDK` with the breathing bundle plus pulse, HRV, the relative arterial-pressure waveform, expressions, and talking. It calls `useCustomInput(FrameTransform.kNone)`, then `start()`, then `sendFrame(rgb, width, height, width * 3, PixelFormat.kRGB, timestampUs)` for each JPEG the phone sends. Metrics are decoded with `decodeMetrics` from `@smartspectra/node-sdk/messages`.

What the person sees:

- Pulse, once the library’s confidence is above zero. The copy says it usually takes about 12 seconds, and it does not show a number before that.
- Breathing, which the library holds at zero confidence until about 30 seconds. The ring around the preview breathes at that rate once a rate exists, and follows the chest trace when one is arriving. Reduced-motion settings leave the ring still.
- Beat-to-beat variation only after about a minute, labelled as RMSSD, not as stress.
- The SDK’s validation hint, in its own words, when the face is missing, the room is dark, or the person should hold still.
- A face description such as “a quiet face”, with the line “a face is not a feeling”. The picture they tap is the answer.

Each signal on the check-in is labelled warming up, live, or stale. A warming signal shows a dash, never a zero. A stale one shows the last number and how long ago it arrived (older than 3 seconds). The breathing ring moves only while breathing is actually live. Trace points are not joined across a gap, and missing seconds are not filled in. Each check-in keeps a count of samples and of valid seconds, so a reader can see how thin the sitting was.

The family view compares only pulse and breathing, and only when a reading is eligible:

- live, not the sample
- confidence at least 40 (pulse) or 45 (breathing), the SDK’s own steady marks
- inside the range that method can read (pulse 40–110, breathing 5–40)
- at least 8 distinct seconds at that confidence in the same check-in

Eligible readings are one per UTC date. With fewer than 5 earlier days the screen says “Still learning their usual”. After that, the band is the middle half of up to 14 of those days, widened so a tiny step is not called different. HRV (RMSSD and SDNN) and a face description are shown beside that, labelled as not part of the comparison and not a wellbeing score.

## Prize Categories

**Best Thoughtful Real-World Use.** The need is ordinary and a bit stubborn: someone at home, a family who wants a light daily check without turning a camera into a monitor, and a page they can hand to a professional without it pretending to be a chart of illness. Consent, a visible camera, one-tap deletion, and a comparison against the person’s own days are the product, not a settings footnote.

**Most Creative or Delightful Use.** The nod can be a picture, a sentence, or just showing up. The check-in is paced like a breath rather than a dashboard, and the “different” state is a sentence about their own week, not a red alarm.

## Consent and Data Handling

**Camera.** Off until a check-in starts from the agreement screen. The agreement stores who agreed (their name), who the check-in is for, whether they agreed as themselves or with the person present, the time, and the text version. Preview, the words “Camera is on”, and Stop stay visible. Withdraw agreement stops the camera immediately. It does not delete days already kept. There is no background mode.

**Processing.** JPEG frames travel to this app’s server for the length of the check-in and are passed to the SmartSpectra SDK in memory. They are not written to disk, not written to the log, and not shared onward as video.

**Storage.** SQLite holds the house word, a scrypt PIN hash, names, versioned agreements, the picture tapped, a typed note, derived numbers, confidences, and valid-second counts. No audio. No landmarks.

**Sharing.** Anyone with the house word and PIN can see that record. A printed summary or the JSON download is a copy the app cannot take back.

**Retention and deletion.** Default 30 days, changeable to 7 or 90. Delete all our data is separate from withdrawing agreement. On Render’s free tier the disk is ephemeral, and the app says so.

**SDK telemetry, separately from required setup.** Optional telemetry is off (`enableTelemetry: false`). If it were on, Presage would receive session summaries and fuller readiness reports, which can include free text such as paths, on an authenticated request. They do not include frames or vital signs. Turning telemetry off does not make the app offline: a live check-in still contacts Presage to authenticate the API key and let the library set itself up. The library is proprietary; I do not claim to have audited every request it makes.

**AI.** None. LLM Insights are never called. Speech is not transcribed. The note is whatever someone types.

**What this is not.** Not a medical device. No diagnosis. No treatment advice. No wellbeing score. “Usual” and “different” compare a person with their own recent check-ins. If you are worried, contact a doctor or a person you trust.

#presagechallenge
