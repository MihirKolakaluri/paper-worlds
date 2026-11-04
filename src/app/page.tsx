/* eslint-disable @next/next/no-img-element -- one small static drawing */
import Link from "next/link";
import s from "./landing.module.css";

const STEPS = [
  ["Draw", "Platforms, lava, a stick figure and a flag."],
  ["Snap", "Your drawing becomes a real game."],
  ["Play", "Your own hand is the controller."],
];
const POWERS = [
  ["Steer with your hand", "Slide a sticky note and you ride it through your level. Dodge what flies at you."],
  ["Change the rules", "Say or type \"make the lava rise\" and it does."],
];
const MODELS = [
  ["Muse Spark", "Looks at your pen marks and knows which is a platform, lava, the flag or you."],
  ["SAM 3.1", "Finds your sticky note in a live camera picture and keeps it on track."],
  ["Muse Wonder", "Turns one plain sentence into a safe game rule in seconds."],
  ["Muse Voice Transcribe", "Hears you say the rule so you never leave the game."],
];

export default function Home() {
  return (
    <main className={s.main}>
      <p className={s.brand}>Paper Worlds</p>
      <h1 className={s.h1}><span className={s.nb}>If you can draw it,</span> <span className={s.nb}>you can play it.</span></h1>
      <p className={s.lead}>Everyone has a game in their head. Making one takes code. Paper Worlds takes a pen.</p>
      <div className={s.row}>
        <Link className={s.btn} href="/play?demo=a">Play this drawing</Link>
        <Link className={s.btnGhost} href="/make">Make your own</Link>
      </div>
      <figure className={s.drawing}>
        <img src="/samples/a-hero.jpg" alt="A pen drawing of a game level with platforms, red lava, a stick figure and a flag" width={1280} height={590} />
        <figcaption>Play this sample instantly. No camera or setup needed.</figcaption>
      </figure>
      <ol className={s.how} aria-label="How it works">
        {STEPS.map(([t, d]) => <li key={t}><h2>{t}</h2><p>{d}</p></li>)}
      </ol>
      <section className={s.powers}>
        {POWERS.map(([t, d]) => <div key={t}><h2>{t}</h2><p>{d}</p></div>)}
      </section>
      <section className={s.meta}>
        <p className={s.eyebrow}>Built on the Meta Model API</p>
        <h2 className={s.h2}>Four Meta models. One piece of paper.</h2>
        <div className={s.models}>
          {MODELS.map(([t, d]) => <div key={t} className={s.model}><h3>{t}</h3><p>{d}</p></div>)}
        </div>
      </section>
    </main>
  );
}
