/* eslint-disable @next/next/no-img-element -- two small static drawings */
import Link from "next/link";
import s from "./landing.module.css";

export default function Home() {
  return (
    <main className={s.main}>
      <h1 className={s.h1}>Paper Worlds</h1>
      <p className={s.lead}>Draw a game on paper. Play it a few seconds later.</p>
      <div className={s.row}>
        <Link className={s.btn} href="/play?demo=a">Try it now (no setup)</Link>
        <Link className={s.btnGhost} href="/make">Make your own</Link>
      </div>
      <figure className={s.drawing}>
        <img src="/samples/b.jpg" alt="A pen drawing of a game level with platforms, red lava, a stick figure and a flag" width={1280} height={741} />
        <figcaption>This drawing is a level you can play right now.</figcaption>
      </figure>
      <section className={s.how} aria-label="How it works">
        <div><h2>Draw</h2><p>Dark lines are platforms and red is lava. Add a stick figure and a flag.</p></div>
        <div><h2>Snap</h2><p>Muse Spark reads your page and your own strokes become the level.</p></div>
        <div><h2>Play</h2><p>Sticky notes under the camera turn into live platforms. Type a rule and the game changes.</p></div>
      </section>
    </main>
  );
}
