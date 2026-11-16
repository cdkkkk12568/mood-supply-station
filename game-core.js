/* 心情补给站 · Offline, frame-rate independent simulation. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoodGame = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WORLD = Object.freeze({ width: 1280, height: 800, duration: 120 });
  // Public tuning knobs for the two exhibition modes.
  // Five support actions keep the original 1–3 minute pacing while making
  // the finish line explicit: the fifth delivery lights the beacon.
  const TOTAL_DELIVERIES = 5;
  const STAR_THRESHOLDS = Object.freeze({ three: 60, two: 90 });
  const MODES = Object.freeze({
    timed: Object.freeze({ id: 'timed', label: '限时体验版', duration: WORLD.duration }),
    free: Object.freeze({ id: 'free', label: '自由探索版', duration: null })
  });
  const SUPPLIES = Object.freeze([
    Object.freeze({ id: 'rest', label: '休息一下', subtitle: '给自己一点空隙', x: 220, y: 170, color: '#edb55e', icon: 'cup' }),
    Object.freeze({ id: 'plan', label: '拆分小目标', subtitle: '从小小的一步开始', x: 640, y: 140, color: '#8cae8e', icon: 'flag' }),
    Object.freeze({ id: 'talk', label: '找人聊聊', subtitle: '让支持靠近一点', x: 1060, y: 170, color: '#c79aa2', icon: 'chat' })
  ]);
  const SCENARIOS = Object.freeze([
    {
      id: 'busy', title: '有点忙不过来', text: '事情一下子涌来，我有点忙不过来。',
      feedback: {
        rest: '谢谢你。先歇一会儿，我可以慢慢来。',
        plan: '原来可以先做一小件事，感觉有方向了。',
        talk: '有人愿意听我说，我不用一个人扛着。'
      }
    },
    {
      id: 'expectation', title: '努力后的小失落', text: '努力了很久，却没有达到期待。',
      feedback: {
        rest: '先照顾一下疲惫的自己，努力值得被看见。',
        plan: '这次的结果之外，我还可以选一个小目标。',
        talk: '把失落说出来后，我觉得被理解了一点。'
      }
    },
    {
      id: 'connection', title: '想靠近大家', text: '想融入大家，却不知道怎样开口。',
      feedback: {
        rest: '允许自己慢一点，我可以按自己的节奏来。',
        plan: '先从一句“你好”开始，好像没那么难了。',
        talk: '谢谢你愿意陪我聊聊，这就是一个开始。'
      }
    },
    {
      id: 'change', title: '面对新变化', text: '换了新环境，熟悉的节奏都变了。',
      feedback: {
        rest: '适应需要时间，我可以先安顿好自己。',
        plan: '先熟悉一条路、一个地方，就算向前一步。',
        talk: '向身边的人问问，也能找到新的支持。'
      }
    },
    {
      id: 'comparison', title: '有点不够自信', text: '看到别人进步，我有点怀疑自己。',
      feedback: {
        rest: '先离开比较一会儿，给自己一些空间。',
        plan: '我也有自己的节奏，先记下一点小进步。',
        talk: '说出这些感受后，我发现自己并不孤单。'
      }
    },
    {
      id: 'ask', title: '想得到一些帮助', text: '遇到一件难事，开口求助让我有些犹豫。',
      feedback: {
        rest: '先给自己一点时间，我不必立刻解决一切。',
        plan: '把需要的帮助写成一句话，会更容易开口。',
        talk: '谢谢你。向可信赖的人求助也是一种力量。'
      }
    }
  ]);
  const EPSILON = 1e-7;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const supplyLabel = type => SUPPLIES.find(item => item.id === type).label;

  class Game {
    constructor(options = {}) {
      this.random = typeof options.random === 'function' ? options.random : Math.random;
      this.mode = options.mode === 'free' ? 'free' : 'timed';
      this.reset({ mode: this.mode });
    }

    reset(options = {}) {
      // Accept reset('free') and reset({ mode: 'free' }) so the UI can switch
      // modes without reaching into the simulation internals.
      const requestedMode = typeof options === 'string' ? options : options && options.mode;
      if (requestedMode === 'free' || requestedMode === 'timed') this.mode = requestedMode;
      if (!MODES[this.mode]) this.mode = 'timed';
      this.status = 'ready';
      this.remaining = MODES[this.mode].duration;
      this.elapsed = 0;
      this.completionTime = null;
      this.stars = 0;
      this.outcome = null;
      this.player = { x: 640, y: 590, radius: 18, facing: 1, carry: null, slowTimer: 0, invulnerable: 0 };
      this.supplies = SUPPLIES.map(item => ({ ...item }));
      this.npcs = [
        { id: 'npc-0', name: '小禾', x: 190, y: 500, scenarioIndex: 0, color: '#dda65f' },
        { id: 'npc-1', name: '阿橙', x: 1090, y: 500, scenarioIndex: 1, color: '#b290b3' },
        { id: 'npc-2', name: '小满', x: 640, y: 690, scenarioIndex: 2, color: '#7faaa4' }
      ].map(npc => ({ ...npc, scenario: SCENARIOS[npc.scenarioIndex], cooldown: 0, deliveredCount: 0, lastFeedback: '' }));
      const paths = [
        [400, 300, 170, 55, 0.3, 0.58, '事情拥挤'],
        [880, 300, 170, 55, 2.6, -0.54, '周围噪声'],
        [385, 540, 105, 105, 1.9, -0.48, '时间压力'],
        [895, 540, 105, 105, 4.1, 0.46, '事情拥挤'],
        [640, 335, 190, 65, 1.5, 0.40, '周围噪声']
      ];
      this.obstacles = paths.map((path, i) => {
        const phase = path[4] + this.random() * 0.6;
        return {
          id: 'cloud-' + i, cx: path[0], cy: path[1], ax: path[2], ay: path[3], phase,
          speed: path[5], label: path[6], radius: 35, slowTimer: 0,
          x: path[0] + Math.cos(phase) * path[2], y: path[1] + Math.sin(phase) * path[3]
        };
      });
      this.dropped = [];
      this.deliveries = [];
      this.counts = { rest: 0, plan: 0, talk: 0 };
      this.score = 0;
      this.energy = 0;
      this.skillCooldown = 0;
      this.skillActive = 0;
      this.skillCenter = { x: 640, y: 590 };
      this.holdProgress = 0;
      this.endReason = null;
      this._events = [];
      this._dropId = 0;
      this._holdingUsed = false;
      return this;
    }

    setMode(mode) {
      if (!MODES[mode]) return this.mode;
      this.mode = mode;
      this.reset({ mode });
      return this.mode;
    }

    getModeLabel() { return MODES[this.mode].label; }

    getStars(elapsed = this.completionTime == null ? this.elapsed : this.completionTime) {
      if (!Number.isFinite(elapsed)) return 0;
      // Accumulated animation-frame fractions can differ from an exact second
      // by a tiny floating-point error; boundaries remain inclusive.
      if (elapsed <= STAR_THRESHOLDS.three + EPSILON) return 3;
      if (elapsed <= STAR_THRESHOLDS.two + EPSILON) return 2;
      return 1;
    }

    getCompletionStatus() {
      if (this.status === 'completed') return 'completed';
      if (this.status === 'failed') return 'failed';
      return 'in_progress';
    }

    // Both game.player and game.state.player refer to the same live simulation.
    get state() { return this; }

    start() {
      if (this.status === 'ready') this.status = 'running';
      return this.status;
    }

    pause() {
      if (this.status !== 'running') return this.status;
      this.status = 'paused';
      this.holdProgress = 0;
      this._holdingUsed = false;
      return this.status;
    }

    resume() {
      if (this.status !== 'paused') return this.status;
      this.status = 'running';
      this.holdProgress = 0;
      this._holdingUsed = false;
      return this.status;
    }

    _emit(event) {
      this._events.push(event);
      if (this._events.length > 150) this._events.shift();
      return event;
    }

    drainEvents() {
      const events = this._events;
      this._events = [];
      return events;
    }

    _drop(type, x, y) {
      const drop = {
        id: 'drop-' + this._dropId++, type,
        x: clamp(x, 85, WORLD.width - 85), y: clamp(y, 110, WORLD.height - 75),
        // Drops remain recoverable for the rest of the round, even if ttl reaches zero.
        ttl: Math.max(45, this.remaining + 1)
      };
      this.dropped.push(drop);
      return drop;
    }

    update(dt, input = {}) {
      if (this.status !== 'running' || !Number.isFinite(dt) || dt <= 0) return;
      const available = this.mode === 'timed' && Number.isFinite(this.remaining) ? this.remaining : dt;
      dt = Math.min(0.1, dt, available);
      if (this.mode === 'timed') this.remaining = Math.max(0, this.remaining - dt);
      this.elapsed += dt;
      this.skillCooldown = Math.max(0, this.skillCooldown - dt);
      this.skillActive = Math.max(0, this.skillActive - dt);
      const player = this.player;
      player.slowTimer = Math.max(0, player.slowTimer - dt);
      player.invulnerable = Math.max(0, player.invulnerable - dt);

      for (const npc of this.npcs) {
        const previous = npc.cooldown;
        npc.cooldown = Math.max(0, npc.cooldown - dt);
        if (previous > 0 && npc.cooldown === 0) {
          npc.scenarioIndex = (npc.scenarioIndex + 1) % SCENARIOS.length;
          npc.scenario = SCENARIOS[npc.scenarioIndex];
        }
      }
      for (const item of this.dropped) item.ttl = Math.max(0, item.ttl - dt);

      let dx = Number.isFinite(input.x) ? input.x : 0;
      let dy = Number.isFinite(input.y) ? input.y : 0;
      const magnitude = Math.hypot(dx, dy);
      if (magnitude > 1) { dx /= magnitude; dy /= magnitude; }
      const moving = magnitude > 0.01;
      const speed = player.slowTimer > 0 ? 132 : 240;
      player.x = clamp(player.x + dx * speed * dt, 70, WORLD.width - 70);
      player.y = clamp(player.y + dy * speed * dt, 95, WORLD.height - 60);
      if (Math.abs(dx) > 0.01) player.facing = Math.sign(dx);

      if (!input.holding) {
        this.holdProgress = 0;
        this._holdingUsed = false;
      } else if (!moving && !this._holdingUsed && this.skillCooldown <= EPSILON) {
        this.holdProgress = Math.min(1, this.holdProgress + dt / 0.65);
        if (this.holdProgress >= 1 - EPSILON) {
          this.useSkill();
          this._holdingUsed = true;
        }
      } else {
        this.holdProgress = 0;
      }

      for (const cloud of this.obstacles) {
        cloud.slowTimer = Math.max(0, cloud.slowTimer - dt);
        cloud.phase += cloud.speed * dt * (cloud.slowTimer > 0 ? 0.16 : 1);
        cloud.x = cloud.cx + Math.cos(cloud.phase) * cloud.ax;
        cloud.y = cloud.cy + Math.sin(cloud.phase) * cloud.ay;
        if (player.invulnerable <= 0 && distance(player, cloud) < player.radius + cloud.radius - 5) {
          player.slowTimer = 1.15;
          player.invulnerable = 2.6;
          this.holdProgress = 0;
          let message = '遇到一点拥挤，慢慢来就好。';
          const lostType = player.carry;
          if (lostType) {
            const vx = player.x - cloud.x;
            const vy = player.y - cloud.y;
            const length = Math.hypot(vx, vy) || 1;
            this._drop(lostType, player.x + vx / length * 45, player.y + vy / length * 45);
            player.carry = null;
            message = '补给落在身边了，按空格就能捡回来。';
          }
          this._emit({ type: 'collision', message, x: player.x, y: player.y, supplyType: lostType });
        }
      }

      if (this.mode === 'timed' && this.remaining <= EPSILON) {
        this.remaining = 0;
        this.status = this.deliveries.length >= TOTAL_DELIVERIES ? 'completed' : 'failed';
        this.endReason = this.status === 'completed' ? 'completed' : 'time';
        this.outcome = this.status;
        this.completionTime = this.status === 'completed' ? this.elapsed : null;
        this.stars = this.status === 'completed' ? this.getStars(this.elapsed) : 0;
        this.holdProgress = 0;
        this._emit({
          type: 'finish', outcome: this.status, elapsed: this.elapsed, stars: this.stars,
          message: this.status === 'completed' ? '这一程完成了，每一份关心都留下了光。' : '时间到了，你送出的每一份支持都已经被看见。', x: 640, y: 410
        });
      }
    }

    getContext() {
      const player = this.player;
      const nearby = (list, range) => list.filter(item => distance(player, item) <= range)
        .sort((a, b) => distance(player, a) - distance(player, b))[0];
      const dropped = nearby(this.dropped, 85);
      if (dropped) return {
        kind: 'recover', label: (player.carry ? '换回' : '拾回') + '「' + supplyLabel(dropped.type) + '」', targetId: dropped.id
      };
      if (player.carry) {
        const eligible = this._eligibleNpcs();
        const npc = nearby(eligible, 95);
        if (npc) return { kind: 'deliver', label: '把「' + supplyLabel(player.carry) + '」送给' + npc.name, targetId: npc.id };
        const blocked = nearby(this.npcs.filter(item => item.cooldown <= 0), 95);
        if (blocked) return { kind: 'blocked', label: '先去支持其他朋友', targetId: blocked.id };
      }
      const supply = nearby(this.supplies, 92);
      if (supply) return {
        kind: 'pickup', label: (player.carry ? '换成' : '领取') + '「' + supply.label + '」', targetId: supply.id
      };
      return { kind: 'none', label: player.carry ? '把补给送到一位伙伴身边' : '到任意补给站领取一份支持', targetId: null };
    }

    _eligibleNpcs() {
      const minimum = Math.min(...this.npcs.map(item => item.deliveredCount || 0));
      return this.npcs.filter(item => item.cooldown <= 0 && (item.deliveredCount || 0) === minimum);
    }

    interact() {
      if (this.status !== 'running') return null;
      const context = this.getContext();
      const player = this.player;
      if (context.kind === 'recover') {
        const index = this.dropped.findIndex(item => item.id === context.targetId);
        const item = this.dropped.splice(index, 1)[0];
        if (player.carry) this._drop(player.carry, player.x + 35, player.y);
        player.carry = item.type;
        return this._emit({ type: 'recover', supplyType: item.type, message: '拾回了「' + supplyLabel(item.type) + '」，继续出发吧。', x: player.x, y: player.y });
      }
      if (context.kind === 'pickup') {
        const item = this.supplies.find(supply => supply.id === context.targetId);
        player.carry = item.id;
        return this._emit({ type: 'pickup', supplyType: item.id, message: '带上「' + item.label + '」，去陪伴一位伙伴。', x: item.x, y: item.y });
      }
      if (context.kind === 'blocked') {
        return this._emit({ type: 'blocked', message: '这位朋友刚刚收到过支持，先去陪伴其他朋友吧。', x: player.x, y: player.y, npcId: context.targetId });
      }
      if (context.kind === 'deliver') {
        const npc = this.npcs.find(item => item.id === context.targetId);
        const type = player.carry;
        const feedback = npc.scenario.feedback[type];
        const delivery = { npcName: npc.name, npcId: npc.id, scenarioId: npc.scenario.id, type, feedback };
        this.deliveries.push(delivery);
        this.counts[type] += 1;
        this.score += 100;
        this.energy = Math.min(100, Math.round(100 * this.deliveries.length / TOTAL_DELIVERIES));
        npc.cooldown = 3;
        npc.deliveredCount = (npc.deliveredCount || 0) + 1;
        npc.lastFeedback = feedback;
        player.carry = null;
        const event = this._emit({
          type: 'deliver', supplyType: type, feedback, npcId: npc.id, npcName: npc.name,
          message: npc.name + '：' + feedback, x: npc.x, y: npc.y,
          score: this.score, energy: this.energy, lit: false
        });
        // The final completed support action is the finish line. Energy is
        // kept as an integer progress bar for the existing UI, then snaps to
        // full light exactly when all target deliveries are done.
        if (this.deliveries.length >= TOTAL_DELIVERIES) {
          this.energy = 100;
          this.status = 'completed';
          this.endReason = 'completed';
          this.outcome = 'completed';
          this.completionTime = this.elapsed;
          this.stars = this.getStars(this.completionTime);
          event.lit = true;
          event.energy = this.energy;
          event.outcome = 'completed';
          this._emit({
            type: 'finish', outcome: 'completed', elapsed: this.completionTime,
            stars: this.stars, message: '心情灯塔点亮了！这一程完成。', x: 640, y: 410
          });
        }
        return event;
      }
      return null;
    }

    useSkill() {
      if (this.status !== 'running' || this.skillCooldown > EPSILON) return false;
      this.skillCooldown = 9;
      this.skillActive = 3.5;
      this.skillCenter = { x: this.player.x, y: this.player.y };
      this.holdProgress = 0;
      let affected = 0;
      for (const cloud of this.obstacles) {
        if (distance(this.player, cloud) <= 240 + cloud.radius) {
          cloud.slowTimer = 3.5;
          affected++;
        }
      }
      this._emit({ type: 'skill', message: '暂停片刻 · 附近的压力云慢下来了。', x: this.player.x, y: this.player.y, affected });
      return true;
    }
  }

  return { Game, SUPPLIES, SCENARIOS, WORLD, MODES, TOTAL_DELIVERIES, STAR_THRESHOLDS };
});
