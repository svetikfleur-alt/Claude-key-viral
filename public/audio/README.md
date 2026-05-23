# Audio Assets (Local-First)

This project can render Remotion videos **with music + voiceover** using **local files**.

Put your licensed audio assets here (for example: Artlist, Epidemic Sound, your own recordings).

Files in this folder are not included by default. You provide them locally.

Recommended filenames:

- `music-bed.mp3` (background music)
- `voiceover.wav` (voiceover)

Notes:

- Do not commit licensed tracks to Git.
- If `voiceover.wav` is missing, you can generate it locally on Windows using the provided script:
  - `npm run voiceover:generate`
- If the generator reports no voices available, install a Windows voice pack (Settings -> Time & language -> Speech -> Add voices) or provide your own `voiceover.wav`.
