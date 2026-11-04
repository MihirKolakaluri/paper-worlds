# Paper Worlds

**The next computer is already on your desk.**

A pen is your editor. A sticky note is your controller. Your voice is your code. If you can draw it, you can play it.

![A pen drawing played as a game, reaching the flag](docs/demo.gif)

**Play it now: https://paper-worlds-flame.vercel.app**

Press Start surfing or Play a sample. You don't need paper or a camera or an account.

I built this for the Meta Global AI Developer Hackathon (Indie Developer track) with Muse Spark, SAM 3.1, Muse Wonder and Muse Voice Transcribe.

## What it does

You draw a level with a pen. Dark lines are platforms and red is lava. Add a stick figure and a flag, then take a photo. Your own strokes become the level and your stick figure becomes the hero.

There are two games.

- **Draw your game.** Your drawing plays with the keyboard. Type or say a rule like "make the lava rise every time I clap" and it happens.
- **Asteroid Surf.** Your hand is the controller. Slide a bright sticky note under the camera and you ride a pen plank past asteroids to the end. A mouse or finger works too.

The samples are two of my drawings ready to go and everything works from a laptop or a phone.

## Where this goes

For decades we have come to the computer on its terms, with keyboards and mice and glass. That era is ending. AI can now see a scribble, follow a scrap of paper and hear a sentence. Anything in your hands can run software.

Paper Worlds starts with a game since a game is the fastest way to feel it. The same idea scales to every classroom, workshop and factory floor. Sketch a floor plan and walk it. Move tokens on a table and run a warehouse. Every table is a screen.

## How it works

| Step | What does it |
|---|---|
| Read the drawing | The app flattens the photo in the browser. **Muse Spark** labels each mark as a platform, lava, the flag or the stick figure. The app then fits those labels to the real ink and platforms land exactly where you drew them. |
| Find sticky notes | **SAM 3.1** finds the notes on a camera frame and the app learns each note's color from that same frame. |
| Follow sticky notes | A small color tracker runs in the browser on every frame and that keeps a moving note feeling instant. SAM checks the tracker every few seconds and steps in right away when a note gets lost. |
| Turn a sentence into a rule | **Muse Wonder** compiles your words into a small safe rule with structured output. If you ask for something the game can't do, it says so and suggests something it can. |
| Hear a spoken rule | **Muse Voice Transcribe** turns your voice into text and Wonder takes it from there. |
| Whistle and double clap | These are detected in the browser, since they're sounds and not words. |

The game itself runs on Phaser. A level is checked before you play and if the flag is out of reach the jump gets tuned so you can actually win.

## Built during the hackathon

Everything in this repo was written during the hackathon window (Oct 27 to Nov 4, 2026). The git history starts on Nov 1, 2026.

## Run it yourself

You need a Meta Model API key.

```
cp .env.example .env.local   # add your MODEL_API_KEY
npm install
npm run dev
```

`npm test` runs the unit tests. The browser tests are in `tests/e2e` and run with `npx playwright test tests/e2e`. They need a local server on port 3111 or a `BASE_URL` and the checks in `checks.spec.ts` need a dev server and `--workers=1`.

For the sticky notes use Safari if you want your iPhone as the camera, since Chrome didn't list it when I tested. Blue and green notes work best.

## Credits

- The drawings in `public/samples` are mine.
- Libraries: Next.js (MIT), React (MIT), Phaser (MIT), zod (MIT) and the OpenAI SDK (Apache 2.0), which talks to Meta's API.
- Fonts: Geist and Patrick Hand from Google Fonts.
- Sound effects in the demo video come from Pixabay under the Pixabay Content License: UI Success Chime and Sci-Fi UI Click Sound by SoundShelfStudio and Thin Swoosh by Universfield. The music was made in code for this video.

## License

MIT. See `LICENSE`.
