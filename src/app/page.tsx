/* eslint-disable @next/next/no-img-element -- one small static drawing */
import Link from "next/link";
import s from "./landing.module.css";

const GAMES: { title: string; text: string; cta: string; href: string; more?: string; moreHref?: string }[] = [
  { title: "Draw your game", text: "Draw a level on paper and snap a photo. Play it with your keyboard and change the rules by typing or talking.", cta: "Make your own", href: "/make", more: "Play a sample", moreHref: "/play?demo=a" },
  { title: "Asteroid Surf", text: "Your hand is the controller. Slide a sticky note, your mouse or your finger to surf past asteroids to the end.", cta: "Start surfing", href: "/surf" },
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
      <h1 className={s.h1}><span className={s.nb}>The next computer is</span> <span className={s.nb}>already on your desk.</span></h1>
      <p className={s.lead}>A pen is your editor. A sticky note is your controller. Your voice is your code.</p>
      <p className={s.tagline}>If you can draw it, you can play it.</p>
      <figure className={s.drawing}>
        <img src="/samples/a-hero.jpg" alt="A pen drawing of a game level with platforms, red lava, a stick figure and a flag" width={1280} height={590} />
      </figure>
      <section className={s.games} aria-label="Pick a game">
        {GAMES.map(g => (
          <div key={g.title} className={s.game}>
            <h2>{g.title}</h2>
            <p>{g.text}</p>
            <div className={s.row}>
              <Link className={s.btn} href={g.href}>{g.cta}</Link>
              {g.more && <Link className={s.btnGhost} href={g.moreHref!}>{g.more}</Link>}
            </div>
          </div>
        ))}
      </section>
      <section className={s.vision}>
        <h2 className={s.h2}>Every table is a screen.</h2>
        <p>For decades we have come to the computer on its terms, with keyboards and mice and glass. That era is ending. AI can now see a scribble, follow a scrap of paper and hear a sentence. Anything in your hands can run software.</p>
        <p>Today it&apos;s a game. Next it&apos;s every classroom, every workshop and every factory floor. Nothing to buy and nothing to install. Just the things already in front of you.</p>
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
