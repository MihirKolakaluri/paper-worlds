// PlayScene: the kid's drawing, cleaned up (art.ts), is what you see; an invisible 8 px tilemap built from
// Level.solid/lava does the physics. Phaser is passed in (it is loaded with a dynamic import on the client only).
import type { Level } from "@/schema/level";
import type { Mover } from "@/schema/mover";
import type { Rule } from "@/schema/rule";
import type { GameEvent, GameState, Hooks, HudEvent } from "./hooks";
import { respawnLavaCap } from "./reach";
import { clampRaise, clampSpeed, rearm, rulesFor, spawnSpot, type Active } from "./rules";
import { buildArt, PAPER } from "./art";
import { BUFFER_MS, COYOTE_MS, GRAVITY, physicsFor } from "./physics";

type PhaserNS = typeof import("phaser");
type Arcade = Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;


export function makeGame(P: PhaserNS, parent: HTMLElement, level: Level): { game: Phaser.Game; hooks: Hooks } {
  const T = level.tileSize, W = level.width * T, H = level.height * T;
  const { PH, PW, JUMP, RUN, jumpH } = physicsFor(level.spawn.h, T, level.jumpH);
  const lavaCap = respawnLavaCap(level);
  const tickCbs = new Set<(s: GameState) => void>(), eventCbs = new Set<(e: HudEvent) => void>();
  const fire = (e: HudEvent) => eventCbs.forEach(cb => cb(e));
  let scene: PlayScene | null = null;
  const pending: ((s: PlayScene) => void)[] = [];
  const withScene = (f: (s: PlayScene) => void) => (scene ? f(scene) : pending.push(f));

  const hooks: Hooks = {
    input: { left: false, right: false, jump: false },
    setMoverTarget: (id, x, y) => withScene(s => s.setMoverTarget(id, x, y)),
    setMoverAlpha: (id, a) => withScene(s => s.movers.get(id)?.body.setAlpha(a)),
    addMover: m => withScene(s => s.addMover(m)),
    removeMover: id => withScene(s => s.removeMover(id)),
    applyRule: r => withScene(s => s.applyRule(r)),
    removeRule: id => withScene(s => s.removeRule(id)),
    emit: e => withScene(s => s.trigger(e)),
    onTick: cb => { tickCbs.add(cb); return () => tickCbs.delete(cb); },
    onEvent: cb => { eventCbs.add(cb); return () => eventCbs.delete(cb); },
    restart: () => withScene(s => s.resetLevel()),
  };

  class PlayScene extends P.Scene {
    player!: Arcade;
    layer!: Phaser.Tilemaps.TilemapLayer;
    keys!: Record<string, Phaser.Input.Keyboard.Key>;
    lavaGfx!: Phaser.GameObjects.Graphics;
    extraGfx!: Phaser.GameObjects.Graphics;
    debugOn = false;
    lavaRise = 0; // px of extra lava from the bottom (raise_lava)
    speedMul = 1;
    flipped = false;
    frozenUntil = 0;
    deaths = 0;
    won = false;
    dead = false;
    rules: Active[] = [];
    movers = new Map<string, { body: Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body }; tx: number; ty: number }>();
    moverGroup!: Phaser.Physics.Arcade.Group;
    extraTiles: [number, number][] = [];
    hero!: Phaser.GameObjects.Image;
    heroScale = 1;
    squash = 0; // >0 squashes on landing, <0 stretches
    wasGrounded = true;
    lastGrounded = 0;
    jumpPressedAt = -1e9;
    jumpHeld = false;
    cut = false; // short hop already applied this jump
    intro = false;
    glow!: Phaser.GameObjects.Image;
    dust!: Phaser.GameObjects.Particles.ParticleEmitter;
    confetti!: Phaser.GameObjects.Particles.ParticleEmitter;

    constructor() { super("play"); }

    preload() { if (level.image) this.load.image("photo", level.image); }

    create() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- hooks reach the live scene through this
      scene = this;
      this.physics.world.setBounds(0, 0, W, H);
      this.physics.world.setBoundsCollision(true, true, true, false); // fall off the bottom = die
      this.cameras.main.setBounds(0, 0, W, H).setBackgroundColor(PAPER);
      const photo = level.image ? (this.textures.get("photo").getSourceImage() as HTMLImageElement) : null;
      const art = buildArt(level, photo);
      this.textures.addCanvas("paper", art.paper); this.textures.addCanvas("ink", art.ink); this.textures.addCanvas("lavaArt", art.lava);
      this.textures.addCanvas("glow", art.glow); this.textures.addCanvas("hero", art.hero); this.textures.addCanvas("flag", art.flag);
      this.add.image(0, 0, "paper").setOrigin(0);
      const shadow = this.add.image(2, 3, "ink").setOrigin(0).setTint(0x000000).setAlpha(0.13);
      this.glow = this.add.image(0, -T, "glow").setOrigin(0).setScale(T / 2).setTint(0xff8a1e).setAlpha(0.3);
      const lavaImg = this.add.image(0, 0, "lavaArt").setOrigin(0);
      const inkImg = this.add.image(0, 0, "ink").setOrigin(0);
      // the drawn flag waves from the bottom of its pole
      const flag = this.add.image(art.flagAt.x, art.flagAt.y + art.flag.height, "flag").setOrigin(0, 1);
      this.tweens.add({ targets: flag, scaleX: 0.9, angle: -2, duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      this.tweens.add({ targets: this.glow, alpha: 0.55, duration: 900, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      this.makeParticles(art.lavaTops);

      // tiles: index 1 solid, 2 lava; drawn faintly only in debug mode (press D)
      const g = this.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(0x000000, 0).fillRect(0, 0, T, T);
      g.fillStyle(0x2255ff, 0.55).fillRect(T, 0, T, T);
      g.fillStyle(0xff2222, 0.55).fillRect(2 * T, 0, T, T);
      g.generateTexture("tiles", 3 * T, T); g.destroy();
      const data = level.solid.map((row, r) => row.map((s, c) => (level.lava[r][c] ? 2 : s ? 1 : 0)));
      const map = this.make.tilemap({ data, tileWidth: T, tileHeight: T });
      const ts = map.addTilesetImage("tiles", "tiles", T, T, 0, 0)!;
      this.layer = map.createLayer(0, ts, 0, 0)!.setAlpha(0);
      this.setOneWay();

      const pg = this.make.graphics({ x: 0, y: 0 }, false);
      const hr = PW * 0.32, lw = Math.max(2, PW * 0.22);
      pg.fillStyle(0x1d4ed8).fillCircle(PW / 2, hr, hr).fillRect(PW * 0.2, hr * 2, PW * 0.6, PH * 0.42)
        .fillRect(PW * 0.15, PH * 0.72, lw, PH * 0.28).fillRect(PW * 0.85 - lw, PH * 0.72, lw, PH * 0.28);
      pg.generateTexture("player", PW, PH); pg.destroy();
      this.player = this.physics.add.sprite(0, 0, "player").setVisible(false) as Arcade;
      // the kid's own stick figure is the hero; the invisible box above does the physics
      this.hero = this.add.image(0, 0, "hero").setOrigin(0.5, 1).setDepth(5);
      this.heroScale = (PH * 1.2) / art.hero.height;
      this.player.body.setSize(PW, PH); this.player.body.setMaxVelocity(RUN * 3, JUMP * 1.8);
      this.physics.world.gravity.y = GRAVITY;
      this.physics.add.collider(this.player, this.layer);
      this.moverGroup = this.physics.add.group({ allowGravity: false, immovable: true });
      this.physics.add.collider(this.player, this.moverGroup);

      this.lavaGfx = this.add.graphics().setDepth(4);
      this.extraGfx = this.add.graphics().setDepth(3);
      const goal = this.add.zone(level.goal.x * T, level.goal.y * T, level.goal.w * T, level.goal.h * T).setOrigin(0);
      this.physics.add.existing(goal, true);
      this.physics.add.overlap(this.player, goal, () => this.win());

      const kb = this.input.keyboard!;
      this.keys = kb.addKeys("LEFT,RIGHT,UP,SPACE,A,D,W,R") as Record<string, Phaser.Input.Keyboard.Key>;
      kb.on("keydown-D", (ev: KeyboardEvent) => { if (ev.shiftKey) { this.debugOn = !this.debugOn; this.layer.setAlpha(this.debugOn ? 1 : 0); } });
      kb.on("keydown-R", () => this.resetLevel());

      this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
      this.spawn();
      if (photo) this.playIntro([shadow, inkImg, lavaImg, this.glow, flag]);
      pending.splice(0).forEach(f => f(this));
      fire({ type: "start" });
    }

    setOneWay() {
      // platforms are one-way: jump up through them, land on top (land on the underside when gravity is flipped)
      this.layer.forEachTile(t => { if (t.index === 1) t.setCollision(false, false, !this.flipped, this.flipped); else t.setCollision(false); });
    }

    makeParticles(lavaTops: [number, number][]) {
      const dot = this.make.graphics({ x: 0, y: 0 }, false);
      dot.fillStyle(0xffffff).fillCircle(4, 4, 4); dot.generateTexture("dot", 8, 8); dot.destroy();
      const chip = this.make.graphics({ x: 0, y: 0 }, false);
      chip.fillStyle(0xffffff).fillRect(0, 0, 6, 10); chip.generateTexture("chip", 6, 10); chip.destroy();
      if (lavaTops.length) {
        const source = { getRandomPoint: (pt: Phaser.Types.Math.Vector2Like) => { const q = lavaTops[(Math.random() * lavaTops.length) | 0]; pt.x = q[0] + (Math.random() - 0.5) * T; pt.y = q[1]; } };
        this.add.particles(0, 0, "dot", {
          emitZone: { type: "random", source }, frequency: Math.max(40, 2400 / lavaTops.length), lifespan: { min: 700, max: 1400 },
          speedY: { min: -60, max: -25 }, speedX: { min: -10, max: 10 }, scale: { start: 0.55, end: 0 }, alpha: { start: 0.9, end: 0 },
          tint: [0xffb02e, 0xff6a1a, 0xffd35c], blendMode: "ADD", gravityY: -10,
        }).setDepth(4);
      }
      this.dust = this.add.particles(0, 0, "dot", {
        emitting: false, lifespan: 380, speedX: { min: -70, max: 70 }, speedY: { min: -50, max: -10 }, gravityY: 120,
        scale: { start: 0.6, end: 0 }, alpha: { start: 0.45, end: 0 }, tint: 0x9a8f7c,
      }).setDepth(6);
      this.confetti = this.add.particles(0, 0, "chip", {
        emitting: false, lifespan: 1600, speed: { min: 150, max: 420 }, angle: { min: 220, max: 320 }, gravityY: 600,
        rotate: { start: 0, end: 540 }, scale: { min: 0.6, max: 1.1 }, tint: [0xe5383b, 0x1d4ed8, 0xf4b400, 0x16a34a, 0x9333ea],
      }).setDepth(7);
    }

    /** The messy photo melts into the clean page, the lines draw in, then the figure pops off the paper. */
    playIntro(drawn: Phaser.GameObjects.Image[]) {
      this.intro = true; this.physics.pause();
      this.tweens.killTweensOf(this.hero); this.hero.setScale(0).setPosition(this.player.x, this.player.body.bottom);
      const photoImg = this.add.image(0, 0, "photo").setOrigin(0).setDisplaySize(W, H).setDepth(20);
      const wipe = this.make.graphics({ x: 0, y: 0 }, false), state = { w: 0 };
      const mask = wipe.createGeometryMask(); drawn.forEach(d => d.setMask(mask));
      const draw = () => { wipe.clear().fillStyle(0xffffff).fillRect(0, 0, state.w, H); };
      draw();
      const done = () => {
        if (!this.intro) return; this.intro = false;
        this.tweens.killTweensOf([photoImg, state, this.hero]);
        photoImg.destroy(); drawn.forEach(d => d.clearMask()); wipe.destroy();
        this.hero.setScale(this.heroScale); this.physics.resume();
      };
      this.tweens.add({ targets: photoImg, alpha: 0, delay: 650, duration: 650, ease: "Sine.in" });
      this.tweens.add({ targets: state, w: W, delay: 750, duration: 900, ease: "Sine.inOut", onUpdate: draw });
      this.tweens.add({ targets: this.hero, scale: this.heroScale, delay: 1650, duration: 420, ease: "Back.out", onComplete: done });
      this.input.keyboard!.once("keydown", done);
      this.input.once("pointerdown", done);
    }

    spawn() {
      if (this.flipped) this.flip(); // a fresh start, or flipped gravity throws you off the top again and again
      this.player.setPosition(level.spawn.x * T, level.spawn.y * T + PH / 2).setVelocity(0, 0).setFlipY(this.flipped);
      // risen lava drops back below the start, or you would respawn into it and die forever
      this.lavaRise = Math.min(this.lavaRise, lavaCap);
      this.dead = false; this.cut = false; this.jumpPressedAt = -1e9;
      if (this.hero && !this.intro) { this.hero.clearTint().setAlpha(1).setScale(0); this.tweens.add({ targets: this.hero, scale: this.heroScale, duration: 260, ease: "Back.out" }); }
    }

    die() {
      if (this.dead || this.won) return;
      this.dead = true; this.deaths++;
      this.cameras.main.shake(140, 0.008); this.cameras.main.flash(160, 255, 90, 70);
      this.hero.setTint(0xff3b3b);
      fire({ type: "die" });
      this.runRules(r => r.trigger.type === "touch" && r.trigger.target === "lava");
      this.time.delayedCall(450, () => this.spawn());
    }

    win() {
      if (this.won || this.dead) return;
      this.runRules(r => r.trigger.type === "touch" && r.trigger.target === "goal");
      this.won = true;
      this.player.setVelocity(0, 0); this.player.body.setAllowGravity(false);
      this.confetti.explode(70, this.player.x, this.player.y - PH);
      this.tweens.add({ targets: this.hero, y: this.hero.y - 18, duration: 220, yoyo: true, repeat: 2, ease: "Sine.out" });
      fire({ type: "win" });
    }

    resetLevel() {
      this.won = false; this.lavaRise = 0; this.speedMul = 1; this.frozenUntil = 0;
      if (this.flipped) { this.flipped = false; this.physics.world.gravity.y = GRAVITY; this.setOneWay(); }
      this.extraTiles.forEach(([c, r]) => this.layer.removeTileAt(c, r)); this.extraTiles = []; this.drawExtra();
      rearm(this.rules, this.time.now, r => this.timerMs(r));
      this.player.body.setAllowGravity(true);
      this.spawn();
      fire({ type: "start" });
    }

    // ---------- rules ----------
    timerMs(r: Rule) { return r.trigger.type === "timer" ? r.trigger.sec * 1000 : Infinity; }
    applyRule(rule: Rule) { this.removeRule(rule.id); this.rules.push({ rule, fired: 0, nextAt: this.time.now + this.timerMs(rule) }); }
    /** Removing a rule also takes back what it did, so × means undo and not just "stop". */
    removeRule(id: string) {
      const gone = this.rules.find(a => a.rule.id === id);
      this.rules = this.rules.filter(a => a.rule.id !== id);
      if (!gone?.fired) return;
      switch (gone.rule.action.type) {
        case "raise_lava": this.lavaRise = Math.max(0, this.lavaRise - (gone.raised ?? 0)); break;
        case "flip_gravity": if (this.flipped) this.flip(); break;
        case "speed": {
          const last = this.rules.filter(a => a.fired && a.rule.action.type === "speed").at(-1)?.rule.action;
          this.speedMul = last?.type === "speed" ? clampSpeed(last.x) : 1; break;
        }
        case "spawn_platform": {
          const mine = new Set((gone.tiles ?? []).map(t => t.join()));
          (gone.tiles ?? []).forEach(([c, r]) => this.layer.removeTileAt(c, r));
          this.extraTiles = this.extraTiles.filter(t => !mine.has(t.join())); this.drawExtra(); break;
        }
        case "freeze_movers": this.frozenUntil = 0; break;
      }
    }
    trigger(e: GameEvent) { this.runRules(r => r.trigger.type === e); }
    runRules(match: (r: Rule) => boolean) {
      for (const a of rulesFor(this.rules, match)) { a.fired++; this.act(a); fire({ type: "rule", id: a.rule.id }); }
    }
    flip() {
      this.flipped = !this.flipped; this.physics.world.gravity.y = this.flipped ? -GRAVITY : GRAVITY;
      this.player.setFlipY(this.flipped); this.setOneWay(); this.drawExtra();
    }
    /** The tile layer is invisible (the drawing is the art), so platforms from rules need their own ink. */
    drawExtra() {
      this.extraGfx.clear().fillStyle(0x1f2433);
      for (const [c, r] of this.extraTiles) this.extraGfx.fillRect(c * T, r * T + (this.flipped ? T - 3 : 0), T, 3);
    }
    act(active: Active) {
      const a = active.rule.action;
      switch (a.type) {
        case "raise_lava": {
          const next = Math.min(H * 0.6, this.lavaRise + clampRaise(a.px));
          active.raised = (active.raised ?? 0) + next - this.lavaRise; this.lavaRise = next; break;
        }
        case "flip_gravity": this.flip(); break;
        case "spawn_platform": {
          const b = this.player.body, w = Math.max(2, Math.round(a.w));
          const near = a.x < 0 || a.y < 0;
          const spot = near ? spawnSpot({ x: this.player.x, feetY: b.bottom, headY: b.top, flipped: this.flipped, facing: this.player.flipX ? -1 : 1,
            onFloor: this.flipped ? b.blocked.up || b.touching.up : b.blocked.down || b.touching.down }, T, level.width, level.height, w, jumpH) : a;
          const c0 = Math.max(0, Math.round(spot.x)), r = Math.max(0, Math.min(level.height - 1, Math.round(spot.y)));
          for (let c = c0; c < Math.min(level.width, c0 + w); c++) {
            if ((this.layer.getTileAt(c, r)?.index ?? 0) > 0) continue; // empty cells are index 0 tiles, not null
            const t = this.layer.putTileAt(1, c, r); t.setCollision(false, false, !this.flipped, this.flipped);
            this.extraTiles.push([c, r]); (active.tiles ??= []).push([c, r]);
          }
          this.drawExtra();
          break;
        }
        case "speed": this.speedMul = clampSpeed(a.x); break;
        case "freeze_movers": this.frozenUntil = this.time.now + Math.min(30, a.sec) * 1000; break;
        case "reset": this.time.delayedCall(0, () => this.resetLevel()); break;
      }
    }

    // ---------- movers (sticky notes) ----------
    addMover(m: Mover) {
      this.removeMover(m.id);
      const w = Math.max(2, m.shape[0]?.length ?? 4) * T, h = Math.max(1, m.shape.length) * T;
      const rect = this.add.rectangle(m.pos.x, m.pos.y, w, h, /^#[0-9a-f]{6}$/i.test(m.color) ? parseInt(m.color.slice(1), 16) : 0x22c55e, 0.85) as Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
      this.moverGroup.add(rect);
      rect.body.setAllowGravity(false).setImmovable(true).setFriction(1, 0); // a physics group defaults friction to 0, which would slide platforms out from under the player
      this.movers.set(m.id, { body: rect, tx: m.pos.x, ty: m.pos.y });
    }
    removeMover(id: string) { const m = this.movers.get(id); if (m) { m.body.destroy(); this.movers.delete(id); } }
    setMoverTarget(id: string, x: number, y: number) { const m = this.movers.get(id); if (m) { m.tx = x; m.ty = y; } }

    drawHero(time: number) {
      if (this.intro) { this.hero.setPosition(this.player.x, this.player.body.bottom); return; }
      const p = this.player, b = p.body, f = this.flipped;
      const moving = Math.abs(b.velocity.x) > 5, grounded = f ? b.blocked.up : b.blocked.down;
      this.squash *= 0.82;
      const air = grounded ? 0 : Math.min(0.12, Math.abs(b.velocity.y) / JUMP * 0.12);
      const sy = (1 - this.squash + air) * this.heroScale, sx = (1 + this.squash * 0.8 - air * 0.6) * this.heroScale;
      const bob = grounded && moving ? Math.abs(Math.sin(time * 0.018)) * 3 : 0;
      if (!this.dead && !this.won) this.hero.setScale(sx, sy);
      this.hero.setOrigin(0.5, f ? 0 : 1).setFlipY(f).setFlipX(b.velocity.x < -5 ? true : b.velocity.x > 5 ? false : this.hero.flipX);
      this.hero.setPosition(p.x, (f ? b.top : b.bottom) + (f ? bob : -bob));
      this.hero.setAngle(grounded ? (moving ? Math.sign(b.velocity.x) * 7 : 0) : Math.max(-12, Math.min(12, b.velocity.x / 25)));
    }

    update(time: number) {
      const p = this.player, b = p.body, kb = this.keys, inp = hooks.input;
      if (!this.won && !this.dead) {
        const left = kb.LEFT.isDown || kb.A.isDown || inp.left, right = kb.RIGHT.isDown || kb.D.isDown || inp.right;
        const jump = kb.UP.isDown || kb.W.isDown || kb.SPACE.isDown || inp.jump;
        const vx = (right ? 1 : 0) - (left ? 1 : 0);
        p.setVelocityX(vx * RUN * this.speedMul);
        if (vx) p.setFlipX(vx < 0);
        const grounded = this.flipped ? b.blocked.up || b.touching.up : b.blocked.down || b.touching.down;
        if (grounded) this.lastGrounded = time;
        if (jump && !this.jumpHeld) this.jumpPressedAt = time;
        this.jumpHeld = jump;
        const up = this.flipped ? 1 : -1;
        // coyote time + jump buffer: forgiving jumps right at ledge edges
        if (time - this.jumpPressedAt < BUFFER_MS && time - this.lastGrounded < COYOTE_MS) {
          p.setVelocityY(up * JUMP); this.jumpPressedAt = -1e9; this.lastGrounded = -1e9; this.cut = false; this.squash = -0.25;
        }
        // let go of jump early for a short hop
        if (!jump && !this.cut && b.velocity.y * up > JUMP * 0.45) { p.setVelocityY(up * JUMP * 0.45); this.cut = true; }
        if (grounded && !this.wasGrounded) { this.squash = 0.3; this.dust.explode(8, p.x, this.flipped ? b.top : b.bottom); }
        this.wasGrounded = grounded;
        // step up over 1-tile bumps from slanted lines
        if (grounded && vx && !this.flipped) {
          const fx = vx > 0 ? b.right + 1 : b.left - 1, feet = b.bottom - 1;
          const ahead = this.layer.getTileAtWorldXY(fx, feet), above = this.layer.getTileAtWorldXY(fx, feet - T);
          if (ahead?.index === 1 && !above) p.y -= T;
        }
        // lava: drawn lava tiles or the rising lava
        const lavaTop = H - this.lavaRise;
        const hit = this.layer.getTilesWithinWorldXY(b.left + 2, b.top + 2, b.width - 4, b.height - 3).some(t => t.index === 2);
        if (hit || b.bottom > lavaTop + 2 || (this.flipped ? b.bottom < -20 : b.top > H + 20)) this.die();
      }
      // timers
      for (const a of this.rules) if (time >= a.nextAt && (a.rule.mode === "every" || a.fired === 0)) {
        a.fired++; a.nextAt = time + this.timerMs(a.rule); this.act(a); fire({ type: "rule", id: a.rule.id });
      }
      // movers chase their targets by velocity (never setPosition, which would tunnel the player)
      const frozen = time < this.frozenUntil;
      for (const m of this.movers.values()) {
        const dx = m.tx - m.body.body.center.x, dy = m.ty - m.body.body.center.y; // targets are the centre of the platform
        m.body.body.setVelocity(frozen ? 0 : Math.max(-900, Math.min(900, dx * 12)), frozen ? 0 : Math.max(-900, Math.min(900, dy * 12)));
      }
      // rising lava
      this.lavaGfx.clear();
      if (this.lavaRise > 0) { const top = H - this.lavaRise, wave = (x: number) => top + Math.sin(x * 0.05 + time * 0.004) * 3; this.lavaGfx.fillStyle(0xff7a1a, 0.35).fillRect(0, top - 6, W, 6).fillStyle(0xe5383b, 0.92).beginPath().moveTo(0, H); for (let x = 0; x <= W; x += 8) this.lavaGfx.lineTo(x, wave(x)); this.lavaGfx.lineTo(W, H).closePath().fillPath(); }
      this.drawHero(time);
      const s: GameState = { x: p.x, y: p.y, vx: b.velocity.x, vy: b.velocity.y, onFloor: b.blocked.down, deaths: this.deaths, won: this.won, lavaTop: H - this.lavaRise, gravityFlipped: this.flipped };
      tickCbs.forEach(cb => cb(s));
    }
  }

  const zoom = Math.max(1, Math.min(3, Math.floor(Math.min(parent.clientWidth / W, (parent.clientHeight || 600) / H) * 10) / 10));
  const game = new P.Game({
    type: P.AUTO, parent, width: W, height: H, pixelArt: false, backgroundColor: PAPER,
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: GRAVITY }, tileBias: 16 } },
    scale: { mode: P.Scale.FIT, autoCenter: P.Scale.CENTER_BOTH, zoom },
    scene: PlayScene,
  });
  return { game, hooks };
}
