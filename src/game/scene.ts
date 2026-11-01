// PlayScene: the drawing is the background, an invisible 8 px tilemap built from Level.solid/lava does the
// physics. Phaser is passed in (it is loaded with a dynamic import on the client only).
import type { Level } from "@/schema/level";
import type { Mover } from "@/schema/mover";
import type { Rule } from "@/schema/rule";
import type { GameEvent, GameState, Hooks, HudEvent } from "./hooks";
import { clampRaise, clampSpeed, rulesFor, type Active } from "./rules";

type PhaserNS = typeof import("phaser");
type Arcade = Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;


export function makeGame(P: PhaserNS, parent: HTMLElement, level: Level): { game: Phaser.Game; hooks: Hooks } {
  const T = level.tileSize, W = level.width * T, H = level.height * T;
  // Size everything from the kid's own stick figure, so a big drawing gets a big player and big jumps.
  const figH = Math.max(24, Math.min(96, (level.spawn.h ?? 6) * T));
  const PH = Math.round(Math.max(16, Math.min(44, figH * 0.6))), PW = Math.round(PH * 0.55);
  const GRAVITY = 1300, JUMP = Math.sqrt(2 * GRAVITY * Math.max(72, figH * 1.7)), RUN = Math.max(130, Math.min(280, figH * 3.2));
  const tickCbs = new Set<(s: GameState) => void>(), eventCbs = new Set<(e: HudEvent) => void>();
  const fire = (e: HudEvent) => eventCbs.forEach(cb => cb(e));
  let scene: PlayScene | null = null;
  const pending: ((s: PlayScene) => void)[] = [];
  const withScene = (f: (s: PlayScene) => void) => (scene ? f(scene) : pending.push(f));

  const hooks: Hooks = {
    input: { left: false, right: false, jump: false },
    setMoverTarget: (id, x, y) => withScene(s => s.setMoverTarget(id, x, y)),
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

    constructor() { super("play"); }

    preload() { if (level.image) this.load.image("bg", level.image); }

    create() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias -- hooks reach the live scene through this
      scene = this;
      this.physics.world.setBounds(0, 0, W, H);
      this.physics.world.setBoundsCollision(true, true, true, false); // fall off the bottom = die
      this.cameras.main.setBounds(0, 0, W, H).setBackgroundColor("#fffdf7");
      if (level.image) this.add.image(0, 0, "bg").setOrigin(0).setDisplaySize(W, H);
      else this.drawFixtureArt();

      // cover the drawn stick figure: the real player "steps out" of the paper
      if (level.image) {
        const px = Math.max(0, Math.floor((level.spawn.x - 4) * T)), py = Math.floor(level.spawn.y * T + 2 * T);
        const src = this.textures.get("bg").getSourceImage() as HTMLImageElement;
        const c = this.textures.getPixel(Math.floor(px * src.width / W), Math.floor(py * src.height / H), "bg");
        const color = c ? P.Display.Color.GetColor(c.red, c.green, c.blue) : 0xf4f0e6;
        const sw = ((level.spawn.w ?? 4) + 3) * T, top = level.spawn.y * T - T;
        let bottom = top; // down to the ground under the figure
        for (let r = Math.floor(level.spawn.y); r < level.height; r++) { if (level.solid[r]?.[Math.floor(level.spawn.x)]) break; bottom = (r + 1) * T; }
        this.add.rectangle(level.spawn.x * T - sw / 2, top, sw, Math.max(T, bottom - top - 2), color).setOrigin(0);
      }

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
      this.player = this.physics.add.sprite(0, 0, "player") as Arcade;
      this.player.body.setSize(PW, PH); this.player.body.setMaxVelocity(RUN * 3, JUMP * 1.8);
      this.physics.world.gravity.y = GRAVITY;
      this.physics.add.collider(this.player, this.layer);
      this.moverGroup = this.physics.add.group({ allowGravity: false, immovable: true });
      this.physics.add.collider(this.player, this.moverGroup);

      this.lavaGfx = this.add.graphics();
      const goal = this.add.zone(level.goal.x * T, level.goal.y * T, level.goal.w * T, level.goal.h * T).setOrigin(0);
      this.physics.add.existing(goal, true);
      this.physics.add.overlap(this.player, goal, () => this.win());

      const kb = this.input.keyboard!;
      this.keys = kb.addKeys("LEFT,RIGHT,UP,SPACE,A,D,W,R") as Record<string, Phaser.Input.Keyboard.Key>;
      kb.on("keydown-D", (ev: KeyboardEvent) => { if (ev.shiftKey) { this.debugOn = !this.debugOn; this.layer.setAlpha(this.debugOn ? 1 : 0); } });
      kb.on("keydown-R", () => this.resetLevel());

      this.cameras.main.startFollow(this.player, true, 0.15, 0.15);
      this.spawn();
      pending.splice(0).forEach(f => f(this));
      fire({ type: "start" });
    }

    setOneWay() {
      // platforms are one-way: jump up through them, land on top (land on the underside when gravity is flipped)
      this.layer.forEachTile(t => { if (t.index === 1) t.setCollision(false, false, !this.flipped, this.flipped); else t.setCollision(false); });
    }

    drawFixtureArt() {
      const g = this.add.graphics();
      level.solid.forEach((row, r) => row.forEach((s, c) => { if (s) g.fillStyle(0x222222).fillRect(c * T, r * T + 3, T, 2); }));
      level.lava.forEach((row, r) => row.forEach((l, c) => { if (l) g.fillStyle(0xe03131, 0.85).fillRect(c * T, r * T, T, T); }));
      const gx = level.goal.x * T, gy = level.goal.y * T;
      g.lineStyle(2, 0x222222).lineBetween(gx + 2, gy, gx + 2, gy + level.goal.h * T);
      g.fillStyle(0x222222).fillTriangle(gx + 3, gy, gx + 3 + level.goal.w * T, gy + 6, gx + 3, gy + 12);
    }

    spawn() {
      this.player.setPosition(level.spawn.x * T, level.spawn.y * T + PH / 2).setVelocity(0, 0).setFlipY(this.flipped);
      this.dead = false;
    }

    die() {
      if (this.dead || this.won) return;
      this.dead = true; this.deaths++;
      this.cameras.main.shake(120, 0.006);
      this.player.setTint(0xff3333);
      fire({ type: "die" });
      this.runRules(r => r.trigger.type === "touch" && r.trigger.target === "lava");
      this.time.delayedCall(450, () => { this.player.clearTint(); this.spawn(); });
    }

    win() {
      if (this.won || this.dead) return;
      this.runRules(r => r.trigger.type === "touch" && r.trigger.target === "goal");
      this.won = true;
      this.player.setVelocity(0, 0); this.player.body.setAllowGravity(false);
      fire({ type: "win" });
    }

    resetLevel() {
      this.won = false; this.lavaRise = 0; this.speedMul = 1; this.frozenUntil = 0;
      if (this.flipped) { this.flipped = false; this.physics.world.gravity.y = GRAVITY; this.setOneWay(); }
      this.extraTiles.forEach(([c, r]) => this.layer.removeTileAt(c, r)); this.extraTiles = [];
      this.rules.forEach(a => { a.fired = 0; a.nextAt = this.time.now + this.timerMs(a.rule); });
      this.player.body.setAllowGravity(true); this.player.clearTint();
      this.spawn();
      fire({ type: "start" });
    }

    // ---------- rules ----------
    timerMs(r: Rule) { return r.trigger.type === "timer" ? r.trigger.sec * 1000 : Infinity; }
    applyRule(rule: Rule) { this.removeRule(rule.id); this.rules.push({ rule, fired: 0, nextAt: this.time.now + this.timerMs(rule) }); }
    removeRule(id: string) { this.rules = this.rules.filter(a => a.rule.id !== id); }
    trigger(e: GameEvent) { this.runRules(r => r.trigger.type === e); }
    runRules(match: (r: Rule) => boolean) {
      for (const a of rulesFor(this.rules, match)) { a.fired++; this.act(a.rule); fire({ type: "rule", id: a.rule.id }); }
    }
    act(rule: Rule) {
      const a = rule.action;
      switch (a.type) {
        case "raise_lava": this.lavaRise = Math.min(H * 0.6, this.lavaRise + clampRaise(a.px)); break;
        case "flip_gravity":
          this.flipped = !this.flipped; this.physics.world.gravity.y = this.flipped ? -GRAVITY : GRAVITY;
          this.player.setFlipY(this.flipped); this.setOneWay(); break;
        case "spawn_platform": {
          const c0 = Math.max(0, Math.round(a.x)), r = Math.max(0, Math.min(level.height - 1, Math.round(a.y)));
          for (let c = c0; c < Math.min(level.width, c0 + Math.max(2, Math.round(a.w))); c++) {
            if (this.layer.getTileAt(c, r)) continue;
            const t = this.layer.putTileAt(1, c, r); t.setCollision(false, false, !this.flipped, this.flipped); this.extraTiles.push([c, r]);
          }
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
      const rect = this.add.rectangle(m.pos.x, m.pos.y, w, h, 0x22c55e, 0.85) as Phaser.GameObjects.Rectangle & { body: Phaser.Physics.Arcade.Body };
      this.moverGroup.add(rect);
      rect.body.setAllowGravity(false).setImmovable(true);
      this.movers.set(m.id, { body: rect, tx: m.pos.x, ty: m.pos.y });
    }
    removeMover(id: string) { const m = this.movers.get(id); if (m) { m.body.destroy(); this.movers.delete(id); } }
    setMoverTarget(id: string, x: number, y: number) { const m = this.movers.get(id); if (m) { m.tx = x; m.ty = y; } }

    update(time: number) {
      const p = this.player, b = p.body, kb = this.keys, inp = hooks.input;
      if (!this.won && !this.dead) {
        const left = kb.LEFT.isDown || kb.A.isDown || inp.left, right = kb.RIGHT.isDown || kb.D.isDown || inp.right;
        const jump = kb.UP.isDown || kb.W.isDown || kb.SPACE.isDown || inp.jump;
        const vx = (right ? 1 : 0) - (left ? 1 : 0);
        p.setVelocityX(vx * RUN * this.speedMul);
        if (vx) p.setFlipX(vx < 0);
        const grounded = this.flipped ? b.blocked.up || b.touching.up : b.blocked.down || b.touching.down;
        if (jump && grounded) p.setVelocityY((this.flipped ? 1 : -1) * JUMP);
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
        a.fired++; a.nextAt = time + this.timerMs(a.rule); this.act(a.rule); fire({ type: "rule", id: a.rule.id });
      }
      // movers chase their targets by velocity (never setPosition, which would tunnel the player)
      const frozen = time < this.frozenUntil;
      for (const m of this.movers.values()) {
        const dx = m.tx - m.body.x, dy = m.ty - m.body.y;
        m.body.body.setVelocity(frozen ? 0 : Math.max(-900, Math.min(900, dx * 12)), frozen ? 0 : Math.max(-900, Math.min(900, dy * 12)));
      }
      // rising lava
      this.lavaGfx.clear();
      if (this.lavaRise > 0) this.lavaGfx.fillStyle(0xe03131, 0.8).fillRect(0, H - this.lavaRise, W, this.lavaRise);
      const s: GameState = { x: p.x, y: p.y, vx: b.velocity.x, vy: b.velocity.y, onFloor: b.blocked.down, deaths: this.deaths, won: this.won, lavaTop: H - this.lavaRise, gravityFlipped: this.flipped };
      tickCbs.forEach(cb => cb(s));
    }
  }

  const zoom = Math.max(1, Math.min(3, Math.floor(Math.min(parent.clientWidth / W, (parent.clientHeight || 600) / H) * 10) / 10));
  const game = new P.Game({
    type: P.AUTO, parent, width: W, height: H, pixelArt: false, backgroundColor: "#fffdf7",
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: GRAVITY }, tileBias: 16 } },
    scale: { mode: P.Scale.FIT, autoCenter: P.Scale.CENTER_BOTH, zoom },
    scene: PlayScene,
  });
  return { game, hooks };
}
