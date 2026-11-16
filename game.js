/* 心情补给站 · Canvas renderer and offline UI controller. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const game = new MoodGame.Game();
  const canvas = $('game-canvas');
  const ctx = canvas.getContext('2d');
  const W = 1280, H = 800;
  const keys = new Set();
  const particles = [];
  const floaters = [];
  let mode = 'home';
  let lastFrame = performance.now();
  let countdownTimer = null;
  let toastTimer = null;
  let soundOn = false;
  let reducedMotion = false;
  let spaceDown = false;
  let spaceStarted = 0;
  let skillTriggered = false;
  let resultShown = false;
  let restartWasRunning = false;
  let missionSignature = '';
  let selectedGameMode = 'timed';
  let viewport = { scale: 1, x: 0, y: 0 };

  const COLORS = {
    ink: '#294c42', leaf: '#8cae8e', deepLeaf: '#47735b', moss: '#b8c8a0',
    water: '#dbece7', water2: '#c6e1db', sand: '#f4e9ca', cream: '#fffdf2',
    orange: '#e5b064', rose: '#d5a0a4', cloud: '#d6dbcd'
  };
  const supplyById = Object.fromEntries(MoodGame.SUPPLIES.map(item => [item.id, item]));

  function resizeCanvas() {
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * ratio));
    canvas.height = Math.max(1, Math.round(rect.height * ratio));
    const scale = Math.min(canvas.width / W, canvas.height / H);
    viewport = { scale, x: (canvas.width - W * scale) / 2, y: (canvas.height - H * scale) / 2 };
    ctx.setTransform(scale, 0, 0, scale, viewport.x, viewport.y);
  }
  window.addEventListener('resize', resizeCanvas);

  function openDialog(dialog) {
    if (!dialog.open) dialog.showModal();
  }
  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }
  function showToast(message, good = false) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.toggle('good', good);
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, good ? 3200 : 2300);
  }
  function addFloater(text, x, y, color = COLORS.deepLeaf) {
    floaters.push({ text, x, y, color, age: 0, life: 2.2 });
  }
  function burst(x, y, color = '#fff8cf', count = 12) {
    if (reducedMotion) return;
    for (let i = 0; i < count; i++) {
      const a = Math.PI * 2 * i / count + Math.random() * .3;
      particles.push({ x, y, vx: Math.cos(a) * (35 + Math.random() * 70), vy: Math.sin(a) * (35 + Math.random() * 70), color, age: 0, life: .65 + Math.random() * .35, size: 2 + Math.random() * 3 });
    }
  }

  function beep(kind) {
    if (!soundOn || !window.AudioContext) return;
    try {
      if (!beep.audio) beep.audio = new AudioContext();
      const audio = beep.audio;
      if (audio.state === 'suspended') audio.resume();
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const now = audio.currentTime;
      const freq = kind === 'deliver' ? 660 : kind === 'skill' ? 330 : kind === 'collision' ? 160 : kind === 'finish' ? 520 : 430;
      osc.type = kind === 'collision' ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freq, now);
      if (kind === 'deliver' || kind === 'finish') osc.frequency.exponentialRampToValueAtTime(freq * 1.28, now + .16);
      gain.gain.setValueAtTime(.0001, now);
      gain.gain.exponentialRampToValueAtTime(.07, now + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, now + (kind === 'collision' ? .18 : .3));
      osc.connect(gain).connect(audio.destination); osc.start(now); osc.stop(now + .32);
    } catch (_) { /* audio is decorative; gameplay remains complete when unavailable */ }
  }

  function setSound(value) {
    soundOn = value;
    const btn = $('sound-btn');
    btn.setAttribute('aria-pressed', String(soundOn));
    btn.querySelector('.tool-text').textContent = soundOn ? '声音开启' : '声音关闭';
    if (soundOn) beep('pickup');
  }
  function setReducedMotion(value) {
    reducedMotion = value;
    document.body.classList.toggle('reduce-motion', reducedMotion);
    $('motion-btn').setAttribute('aria-pressed', String(reducedMotion));
  }

  function showHome() {
    mode = 'home'; resultShown = false; keys.clear(); spaceDown = false;
    $('home-view').hidden = false; $('play-view').hidden = true;
    $('pause-shade').hidden = true; $('countdown').hidden = true; $('interaction-hint').hidden = true;
    closeDialog($('result-dialog')); closeDialog($('restart-dialog'));
    clearInterval(countdownTimer); clearTimeout(toastTimer); countdownTimer = null;
    particles.length = 0; floaters.length = 0; $('toast').hidden = true;
    game.reset({ mode: selectedGameMode }); updateHud(); draw();
  }
  function showPlay() {
    mode = 'play'; $('home-view').hidden = true; $('play-view').hidden = false;
    $('pause-shade').hidden = true; $('result-dialog').close(); $('restart-dialog').close();
    updateMissionCards(); updateHud(); draw();
  }
  function startCountdown(resetFirst = true) {
    if (resetFirst) game.reset({ mode: selectedGameMode });
    keys.clear(); spaceDown = false; skillTriggered = false; resultShown = false;
    particles.length = 0; floaters.length = 0; missionSignature = '';
    clearTimeout(toastTimer); $('toast').hidden = true;
    showPlay();
    $('mode-summary').textContent = selectedGameMode === 'timed' ? '当前选择：限时体验版 · 120 秒内完成' : '当前选择：自由探索版 · 不设倒计时，慢慢完成';
    const layer = $('countdown'); const number = $('countdown-number');
    layer.hidden = false; number.textContent = '3';
    let left = 3;
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      left -= 1;
      if (left <= 0) {
        clearInterval(countdownTimer); countdownTimer = null; layer.hidden = true;
        game.start(); lastFrame=performance.now();
        showToast('出发吧：先领取一份补给。');
        if (document.hidden || !document.hasFocus()) { game.pause(); $('pause-shade').hidden = false; }
        else canvas.focus();
      } else number.textContent = String(left);
    }, 700);
  }

  function togglePause() {
    if (mode !== 'play' || ['completed','failed','ended'].includes(game.status) || !$('countdown').hidden) return;
    if (game.status === 'running') {
      game.pause(); $('pause-shade').hidden = false; keys.clear(); spaceDown = false;
    } else if (game.status === 'paused') {
      game.resume(); lastFrame=performance.now(); $('pause-shade').hidden = true; canvas.focus();
    }
    updateHud();
  }

  function openRestart() {
    if (mode === 'home' || !$('countdown').hidden) return;
    if (['completed','failed','ended'].includes(game.status)) { startCountdown(true); return; }
    restartWasRunning = game.status === 'running';
    if (restartWasRunning) game.pause();
    keys.clear(); spaceDown = false;
    openDialog($('restart-dialog'));
  }

  function cancelRestart() {
    closeDialog($('restart-dialog'));
    if (restartWasRunning && game.status === 'paused') { game.resume(); lastFrame=performance.now(); }
    canvas.focus();
  }

  function enterFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => showToast('请使用浏览器的全屏选项或 F11。'));
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => showToast('此浏览器暂未允许全屏，可使用 F11。'));
    else showToast('此浏览器不支持页面全屏，请使用 F11。');
  }

  function direction() {
    let x = 0, y = 0;
    if (keys.has('ArrowLeft') || keys.has('a')) x -= 1;
    if (keys.has('ArrowRight') || keys.has('d')) x += 1;
    if (keys.has('ArrowUp') || keys.has('w')) y -= 1;
    if (keys.has('ArrowDown') || keys.has('s')) y += 1;
    return { x, y };
  }

  function keyDown(event) {
    const k = event.key;
    const lower = k.length === 1 ? k.toLowerCase() : k;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // Dialog buttons retain Space / Enter / Escape keyboard behavior.
    if (document.querySelector('dialog[open]')) {
      if (lower === 'm') setSound(!soundOn);
      if (lower === 'f') enterFullscreen();
      return;
    }
    if ((k === ' ' || k === 'Enter') && mode === 'home') return;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','w','a','s','d','W','A','S','D'].includes(k) || lower === ' ') event.preventDefault();
    if (event.repeat && ['p','P','Escape','r','R','m','M','f','F'].includes(k)) return;
    if (lower === 'm') { setSound(!soundOn); return; }
    if (lower === 'f') { enterFullscreen(); return; }
    if (lower === 'p' || k === 'Escape') { togglePause(); return; }
    if (lower === 'r') { openRestart(); return; }
    if (k === ' ' || lower === ' ') {
      event.preventDefault();
      if (!spaceDown && mode === 'play' && game.status === 'running') {
        spaceDown = true; spaceStarted = performance.now(); skillTriggered = false;
      }
      return;
    }
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(k) || ['w','a','s','d'].includes(lower)) keys.add(lower);
  }
  function keyUp(event) {
    const k = event.key, lower = k.length === 1 ? k.toLowerCase() : k;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','w','a','s','d'].includes(lower)) keys.delete(lower);
    if (k === ' ' || lower === ' ') {
      event.preventDefault();
      if (spaceDown && mode === 'play' && game.status === 'running') {
        const held = performance.now() - spaceStarted;
        if (held < 650 && !skillTriggered) { game.interact(); processEvents(); updateHud(); }
      }
      spaceDown = false; skillTriggered = false;
    }
  }
  window.addEventListener('keydown', keyDown, { passive: false });
  window.addEventListener('keyup', keyUp, { passive: false });
  window.addEventListener('blur', () => { keys.clear(); spaceDown = false; if (mode === 'play' && game.status === 'running' && $('countdown').hidden) togglePause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { keys.clear(); spaceDown = false; if (mode === 'play' && game.status === 'running') togglePause(); } });

  function updateHud() {
    const sec = Math.max(0, Math.ceil(game.elapsed));
    if (game.mode === 'free') {
      $('timer').textContent = '自由 ' + String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0');
      $('timer').classList.remove('ending');
      $('timer-caption').textContent = '不赶时间，按自己的节奏传递支持';
    } else {
      const left = Math.max(0, Math.ceil(game.remaining));
      $('timer').textContent = String(Math.floor(left / 60)).padStart(2, '0') + ':' + String(left % 60).padStart(2, '0');
      $('timer').classList.toggle('ending', left <= 20 && mode === 'play');
      $('timer-caption').textContent = '限时体验 · 在 120 秒内传递支持';
    }
    $('delivery-count').textContent = game.deliveries.length;
    $('energy-label').textContent = game.energy;
    $('energy-fill').style.width = game.energy + '%';
    $('board-status').textContent = game.energy >= 100 ? '灯塔已点亮 · 正在结算本局' : (game.deliveries.length ? '每一份支持，都让岛屿更亮' : '收集一份补给，开启一段支持');
    const context = game.getContext();
    if (mode === 'play' && (game.status === 'running' || game.status === 'paused')) {
      const hint = $('interaction-hint'); hint.hidden = game.status !== 'running' || context.kind === 'none';
      hint.querySelector('span').textContent = context.label;
      const carry = game.player.carry;
      $('carry-icon').textContent = carry ? supplyById[carry].icon === 'cup' ? '☕' : supplyById[carry].icon === 'flag' ? '▤' : '☏' : '＋';
      $('next-title').textContent = carry ? '带着支持，去找一位朋友' : '先领取一份补给';
      $('next-detail').textContent = carry ? '走近下方角色，短按空格递送。' : '走近上方任意补给站，短按空格。';
      $('skill-btn').disabled = game.skillCooldown > 0;
      $('skill-title').textContent = game.skillCooldown > 0 ? '暂停片刻 · 冷却中 ' + Math.ceil(game.skillCooldown) + 's' : '暂停片刻';
      $('skill-detail').textContent = game.skillCooldown > 0 ? '让时间再走一会儿，技能很快回来' : (game.holdProgress > 0 ? '继续原地停留……' : '原地长按空格，让附近的忙碌慢下来');
      updateMissionCards();
    }
  }
  function updateMissionCards() {
    const minimumSupport = Math.min(...game.npcs.map(n => n.deliveredCount || 0));
    const signature = game.npcs.map(n => n.scenario.id + ':' + (n.cooldown > 0) + ':' + (n.deliveredCount || 0) + ':' + minimumSupport).join('|');
    if (signature === missionSignature) return;
    missionSignature = signature;
    const list = $('mission-list'); list.replaceChildren();
    for (const npc of game.npcs) {
      const hasTurn = (npc.deliveredCount || 0) === minimumSupport;
      const card = document.createElement('article'); card.className = 'mission-card' + (npc.cooldown > 0 ? ' cooldown' : '') + (!hasTurn && npc.cooldown <= 0 ? ' balanced-wait' : '');
      const av = document.createElement('span'); av.className = 'friend-avatar'; av.textContent = npc.name === '小禾' ? '禾' : npc.name === '阿橙' ? '橙' : '满';
      const body = document.createElement('div');
      const head = document.createElement('div'); const strong = document.createElement('strong'); strong.textContent = npc.name; const loc = document.createElement('span'); loc.className = 'location'; loc.textContent = npc.cooldown > 0 ? '刚刚收到支持' : (!hasTurn ? '请先陪伴其他朋友' : '正在等一份支持'); head.append(strong, loc);
      const p = document.createElement('p'); p.textContent = npc.cooldown > 0 ? '谢谢你，我会慢慢来。' : (!hasTurn ? '这一轮先把支持送给还没收到的朋友。' : npc.scenario.text);
      body.append(head, p); card.append(av, body); list.append(card);
    }
  }

  function processEvents() {
    for (const event of game.drainEvents()) {
      if (event.type === 'pickup' || event.type === 'recover') { showToast(event.message); addFloater('带上支持', event.x, event.y - 30, '#6b885d'); burst(event.x, event.y, '#f6d889', 8); beep('pickup'); }
      else if (event.type === 'deliver') { showToast(event.message + (event.lit ? '  ✦ 灯塔已点亮！' : ''), true); addFloater(game.energy >= 100 && !event.lit ? '支持已送达' : '+20 支持能量', event.x, event.y - 38, '#b3874c'); burst(event.x, event.y, '#f4cd78', 18); beep('deliver'); }
      else if (event.type === 'blocked') { showToast(event.message); addFloater('先陪伴其他朋友', event.x, event.y - 30, '#8c886a'); }
      else if (event.type === 'collision') { showToast(event.message); addFloater('慢一点也没关系', event.x, event.y - 30, '#9a8866'); beep('collision'); }
      else if (event.type === 'skill') { if(spaceDown) skillTriggered=true; showToast(event.message); burst(event.x, event.y, '#d9edb9', 12); beep('skill'); }
      else if (event.type === 'finish') { beep('finish'); showResult(event); }
    }
  }
  function showResult(finishEvent = {}) {
    if (resultShown) return;
    resultShown = true; $('pause-shade').hidden = true; $('interaction-hint').hidden = true;
    const completed = finishEvent.outcome === 'completed' || game.status === 'completed';
    const failed = finishEvent.outcome === 'failed' || game.status === 'failed';
    $('result-dialog').classList.toggle('failed', failed);
    $('result-eyebrow').textContent = completed ? game.getModeLabel() + ' · 通关结算' : game.getModeLabel() + ' · 失败结算';
    $('result-title').textContent = completed ? '谢谢你，把支持送了出去。' : '时间到了，感谢你带来的支持。';
    $('result-status').textContent = completed ? '已完成' : '超时未完成';
    keys.clear(); spaceDown = false;
    $('result-time').textContent = formatDuration(game.completionTime == null ? game.elapsed : game.completionTime);
    $('rating-block').hidden = !completed;
    $('result-stars').textContent = completed ? '★'.repeat(game.stars || game.getStars()) + '☆'.repeat(3 - (game.stars || game.getStars())) : '—';
    $('result-count').textContent = game.deliveries.length;
    $('result-energy').textContent = game.energy;
    $('result-description').textContent = completed ? '灯塔已经亮起，也许你会记得：支持从来不只有一种样子。' : '这一局没有完成全部递送，但已经送出的每一份支持都被看见。';
    const actions = $('result-actions'); actions.replaceChildren();
    const labels = { rest: '休息一下', plan: '拆分小目标', talk: '找人聊聊' };
    Object.keys(labels).forEach(id => { const span = document.createElement('span'); span.textContent = labels[id] + ' × ' + game.counts[id]; actions.append(span); });
    const most = Object.entries(game.counts).sort((a,b)=>b[1]-a[1])[0][0];
    const tips = { rest: '你把“先照顾好自己”带到了小岛上。留一点空隙，也是一种前进。', plan: '你把复杂的事情拆成了小小的一步。小步子也在向前。', talk: '你把“可以一起面对”送到了朋友身边。连接本身就是支持。' };
    $('result-tip').textContent = game.deliveries.length ? tips[most] : '有时，先停下来观察，也是一种温柔的开始。';
    openDialog($('result-dialog'));
  }
  function formatDuration(seconds) {
    const value = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
    return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(Math.floor(value % 60)).padStart(2, '0');
  }

  // ---- Canvas illustration ----
  function roundedRect(x,y,w,h,r,fill,stroke) { ctx.beginPath(); ctx.roundRect(x,y,w,h,r); if(fill){ctx.fillStyle=fill;ctx.fill()} if(stroke){ctx.strokeStyle=stroke;ctx.stroke()} }
  function ellipse(x,y,rx,ry,fill) { ctx.beginPath();ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2);ctx.fillStyle=fill;ctx.fill(); }
  function text(label,x,y,size=22,color='#577054',weight=500) { ctx.fillStyle=color;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=weight+' '+size+'px "Microsoft YaHei",sans-serif';ctx.fillText(label,x,y); }
  function plant(x,y,s=1) {
    ctx.save();ctx.translate(x,y);ctx.scale(s,s);ctx.lineWidth=3;ctx.strokeStyle='#8da57a';ctx.beginPath();ctx.moveTo(0,10);ctx.lineTo(0,-12);ctx.moveTo(0,2);ctx.lineTo(-10,-6);ctx.moveTo(0,-3);ctx.lineTo(8,-11);ctx.stroke();ctx.restore();
  }
  function tree(x,y,s=1) {
    ctx.save();ctx.translate(x,y);ctx.scale(s,s);
    ellipse(6,22,30,8,'#a8bd8e30');roundedRect(-5,-10,10,34,3,'#b2a07c');
    ellipse(-12,-15,22,25,'#96b18a');ellipse(12,-22,24,30,'#a1bc90');ellipse(-4,-40,27,28,'#b1c69b');
    ctx.strokeStyle='#8ca37b';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-22);ctx.lineTo(0,-40);ctx.moveTo(0,-28);ctx.lineTo(9,-34);ctx.stroke();ctx.restore();
  }
  function flower(x,y,color='#f3f5dc',s=1) {ctx.save();ctx.translate(x,y);ctx.scale(s,s);for(let i=0;i<5;i++){const a=i*Math.PI*2/5;ellipse(Math.cos(a)*4,Math.sin(a)*4,3,3,color)}ellipse(0,0,2,2,'#d0b56f');ctx.restore()}
  function drawIsland() {
    ctx.clearRect(0,0,W,H);
    const grd=ctx.createLinearGradient(0,0,W,H);grd.addColorStop(0,'#e1ede4');grd.addColorStop(1,'#d1e4db');ctx.fillStyle=grd;ctx.fillRect(0,0,W,H);
    // Water is quiet and sparse; all detailed art is drawn locally.
    ctx.strokeStyle='#b9d4c678';ctx.lineWidth=2;
    for(const [x,y] of [[30,190],[1190,88],[120,754],[1130,760],[1200,620],[80,50],[860,46]]){ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+14,y+5,x+28,y);ctx.moveTo(x+7,y+11);ctx.quadraticCurveTo(x+20,y+15,x+35,y+11);ctx.stroke()}
    ctx.beginPath();ctx.moveTo(70,122);ctx.bezierCurveTo(125,58,280,87,398,84);ctx.bezierCurveTo(570,56,706,80,830,86);ctx.bezierCurveTo(990,72,1160,75,1206,143);ctx.bezierCurveTo(1262,225,1224,342,1240,438);ctx.bezierCurveTo(1255,554,1205,675,1110,712);ctx.bezierCurveTo(980,769,864,738,748,754);ctx.bezierCurveTo(557,792,352,753,224,728);ctx.bezierCurveTo(88,702,44,626,46,522);ctx.bezierCurveTo(51,421,21,333,44,248);ctx.bezierCurveTo(53,208,42,157,70,122);ctx.closePath();
    ctx.fillStyle='#c5d9b345';ctx.lineWidth=25;ctx.strokeStyle='#b6d0b94a';ctx.stroke();ctx.fillStyle='#e1e9cb';ctx.fill();ctx.strokeStyle='#f7f2dc';ctx.lineWidth=12;ctx.stroke();
    // Soft walking paths form a loop, with several ways around the clouds.
    ctx.strokeStyle='#f1ecd8';ctx.lineWidth=54;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();ctx.moveTo(220,195);ctx.bezierCurveTo(239,310,126,398,190,500);ctx.bezierCurveTo(290,597,460,565,640,590);ctx.bezierCurveTo(851,584,1007,594,1090,500);ctx.bezierCurveTo(1150,392,1040,310,1060,195);ctx.stroke();
    ctx.beginPath();ctx.moveTo(640,160);ctx.bezierCurveTo(620,310,664,450,640,690);ctx.stroke();
    ctx.beginPath();ctx.moveTo(204,425);ctx.quadraticCurveTo(640,331,1072,426);ctx.stroke();
    ellipse(640,410,103,86,'#f1ecd8');
    // Tiny meadow marks, placed away from important labels.
    const tufts=[[333,331],[358,589],[940,340],[867,649],[423,220],[839,220],[91,499],[1192,505],[465,701],[815,720],[492,541],[787,541],[333,699],[947,701],[110,188]];
    for(const [x,y] of tufts)plant(x,y,.8);
    for(const [x,y] of [[295,280],[324,291],[966,291],[997,277],[314,606],[356,623],[940,626],[982,610],[523,176],[746,177]])flower(x,y,x%2?'#f8f4db':'#e9bba0',1.2);
    // Border trees are scenery, never invisible walls.
    for(const [x,y,s] of [[92,285,1.15],[109,348,.8],[1170,283,1.1],[1183,349,.85],[104,636,1.1],[151,670,.8],[1172,635,1.1],[1134,676,.8],[400,116,.8],[882,111,.8]])tree(x,y,s);
    // Garden bench and little paper bunting.
    roundedRect(313,711,97,13,4,'#b8a583');roundedRect(320,695,83,11,3,'#c7b78f');roundedRect(325,724,6,13,2,'#a59378');roundedRect(390,724,6,13,2,'#a59378');
    ctx.strokeStyle='#b6c8a0';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(450,91);ctx.quadraticCurveTo(640,144,829,91);ctx.stroke();
    for(let i=0;i<7;i++){const x=477+i*54,y=100+Math.sin((i+1)/8*Math.PI)*20;ctx.fillStyle=['#e4b68c','#b3c49b','#ead196'][i%3];ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+15,y+2);ctx.lineTo(x+5,y+21);ctx.fill()}
  }
  function drawLighthouse() {
    const x=640,y=410,lit=game.energy>=100;
    ctx.save();ctx.translate(x,y);
    if(lit){const glow=ctx.createRadialGradient(0,-60,10,0,-40,140);glow.addColorStop(0,'#f6d57d80');glow.addColorStop(1,'#f6d57d00');ctx.fillStyle=glow;ctx.fillRect(-150,-190,300,300);}
    ellipse(8,47,69,17,'#afbd9233');ellipse(0,34,60,24,'#d4caa8');ellipse(0,25,57,22,'#e8ddbd');
    ctx.beginPath();ctx.moveTo(-35,20);ctx.lineTo(-26,-72);ctx.lineTo(26,-72);ctx.lineTo(35,20);ctx.closePath();ctx.fillStyle='#fff9e6';ctx.fill();
    ctx.save();ctx.clip();ctx.fillStyle='#e6b56c';ctx.fillRect(-37,-39,74,19);ctx.fillRect(-37,1,74,14);ctx.fillStyle='#e8dbc4';ctx.fillRect(20,-80,15,110);ctx.restore();
    roundedRect(-30,-99,60,33,4,lit?'#f8db82':'#bfd3bc');ctx.strokeStyle='#6a8b71';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-16,-98);ctx.lineTo(-16,-67);ctx.moveTo(16,-98);ctx.lineTo(16,-67);ctx.stroke();
    roundedRect(-35,-72,70,7,3,'#6f8b71');ctx.fillStyle='#456e57';ctx.beginPath();ctx.moveTo(-37,-99);ctx.lineTo(0,-124);ctx.lineTo(37,-99);ctx.fill();
    roundedRect(-6,5,12,19,[7,7,0,0],'#67866b');ellipse(0,-46,6,8,'#9cb49a');
    if(lit){ctx.strokeStyle='#d3ae57';ctx.lineWidth=3;for(let i=0;i<6;i++){const a=-Math.PI+i*Math.PI/5;ctx.beginPath();ctx.moveTo(Math.cos(a)*57,-88+Math.sin(a)*38);ctx.lineTo(Math.cos(a)*69,-88+Math.sin(a)*51);ctx.stroke()}}
    text('心情灯塔',0,70,24,'#66805b');
    for(let i=0;i<5;i++)ellipse((i-2)*14,94,4,4,game.energy>=20*(i+1)?'#c79c53':'#c6cbb1');
    ctx.restore();
  }
  function drawSupplyIcon(id,x,y,size=1) {
    ctx.save();ctx.translate(x,y);ctx.scale(size,size);ctx.lineWidth=2.6;ctx.strokeStyle='#fdf9eb';ctx.fillStyle='#fdf9eb';
    if(id==='rest'){roundedRect(-10,-7,18,16,[2,2,7,7],'#fff9e9');ctx.beginPath();ctx.arc(10,0,5,-Math.PI/2,Math.PI/2);ctx.stroke();ctx.beginPath();ctx.moveTo(-4,-14);ctx.quadraticCurveTo(-7,-18,-3,-21);ctx.stroke()}
    else if(id==='plan'){roundedRect(-11,-15,22,28,3,'#fff9e9');ctx.strokeStyle='#88a182';for(let j=0;j<3;j++){ctx.beginPath();ctx.moveTo(-6,-8+j*7);ctx.lineTo(6-j*2,-8+j*7);ctx.stroke()}}
    else {roundedRect(-14,-11,28,20,6,'#fff9e9');ctx.beginPath();ctx.moveTo(-7,7);ctx.lineTo(-9,14);ctx.lineTo(0,8);ctx.fill();for(let j=0;j<3;j++)ellipse(-7+j*7,-1,1.7,1.7,'#a4899a')}
    ctx.restore();
  }
  function drawSupply(s) {
    const colors={rest:['#dfa666','#f9edce'],plan:['#92a87b','#ecedcf'],talk:['#ac9bae','#f0e5e7']};
    const [accent,pale]=colors[s.id];ctx.save();ctx.translate(s.x,s.y);
    ellipse(5,34,80,14,'#9eae7b20');roundedRect(-56,-42,112,67,5,'#faf6df');roundedRect(-61,12,122,16,4,'#c4b18b');
    roundedRect(-49,-27,98,40,3,pale);ctx.fillStyle=accent;ctx.beginPath();ctx.moveTo(-66,-43);ctx.lineTo(-47,-71);ctx.lineTo(47,-71);ctx.lineTo(66,-43);ctx.fill();
    for(let i=0;i<6;i++)roundedRect(-66+i*22,-44,22,16,[0,0,8,8],i%2===0?accent:'#fff8e5');
    ellipse(0,-6,23,23,accent);drawSupplyIcon(s.id,0,-4,.95);
    roundedRect(-89,46,178,38,12,'#fffdf0ed');text(s.label,0,65,23,'#5f7753');
    if(game.player.carry===s.id){text('已携带 ✓',0,100,18,'#9a814d');}
    ctx.restore();
  }
  function drawNpc(npc) {
    const cool=npc.cooldown>0;ctx.save();ctx.translate(npc.x,npc.y);
    ellipse(3,36,38,10,'#a9b68a3b');
    const c=npc.id==='npc-0'?'#f0cf9a':npc.id==='npc-1'?'#d8b4a1':'#d5d7b9';
    // Different ears and clothes identify the three friends without relying on color.
    if(npc.id==='npc-0'){ellipse(-12,-47,8,23,c);ellipse(12,-47,8,23,c);ellipse(-12,-48,3,14,'#e3b9a2');ellipse(12,-48,3,14,'#e3b9a2')}
    else if(npc.id==='npc-1'){ellipse(-22,-31,11,12,c);ellipse(22,-31,11,12,c)}
    else {ctx.fillStyle=c;ctx.beginPath();ctx.moveTo(-25,-15);ctx.lineTo(-23,-45);ctx.lineTo(-3,-26);ctx.lineTo(22,-45);ctx.lineTo(26,-14);ctx.fill()}
    roundedRect(-23,0,46,36,16,npc.color);ellipse(-27,14,8,12,c);ellipse(27,14,8,12,c);ellipse(-13,35,10,5,'#8c8d79');ellipse(13,35,10,5,'#8c8d79');
    ellipse(0,-18,29,27,c);ellipse(-16,-9,5,3,'#d5a08a66');ellipse(16,-9,5,3,'#d5a08a66');ellipse(-9,-21,2.4,3,'#52604d');ellipse(9,-21,2.4,3,'#52604d');
    ctx.strokeStyle='#6d7159';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,-12,5,0,Math.PI);ctx.stroke();
    const labels={busy:'有点忙不过来',expectation:'努力后的小失落',connection:'想靠近大家',change:'面对新变化',comparison:'有点不够自信',ask:'想得到帮助'};
    const label=cool?'谢谢你，收到了！':labels[npc.scenario.id];
    const bx=npc.id==='npc-2'?161:0,by=npc.id==='npc-2'?-66:-118;
    roundedRect(bx-97,by,194,39,12,cool?'#f6f7e6':'#fffdf0');ctx.fillStyle=cool?'#f6f7e6':'#fffdf0';ctx.beginPath();ctx.moveTo(bx-6,by+38);ctx.lineTo(bx-16,by+49);ctx.lineTo(bx+10,by+38);ctx.fill();text(label,bx,by+20,20,'#74826a');
    text(npc.name,0,61,22,'#738166');ctx.restore();
  }
  function drawCloud(cloud) {
    ctx.save();ctx.translate(cloud.x,cloud.y);const slow=cloud.slowTimer>0;
    ellipse(4,29,42,7,'#9da99416');ctx.fillStyle=slow?'#d0dfc2':'#d9d9df';
    ctx.beginPath();ctx.moveTo(-33,23);ctx.bezierCurveTo(-61,21,-54,-14,-30,-13);ctx.bezierCurveTo(-30,-48,20,-48,23,-19);ctx.bezierCurveTo(52,-25,68,19,36,23);ctx.closePath();ctx.fill();
    text(slow?'慢下来':cloud.label,0,4,17,slow?'#809c70':'#92919d');ctx.restore();
  }
  function drawDropped(drop) {
    const colors={rest:'#d6a55f',plan:'#90a880',talk:'#af98ac'};ctx.save();ctx.translate(drop.x,drop.y);
    ctx.strokeStyle='#fff9e9';ctx.lineWidth=2;ctx.setLineDash([4,5]);ctx.beginPath();ctx.arc(0,0,30,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);roundedRect(-19,-18,38,38,10,colors[drop.type]);drawSupplyIcon(drop.type,0,2,.85);ctx.restore();
  }
  function drawPlayer() {
    const p=game.player;ctx.save();ctx.translate(p.x,p.y);
    if(game.skillActive>0){const c=game.skillCenter;ctx.save();ctx.translate(c.x-p.x,c.y-p.y);ctx.fillStyle='#f6fff11c';ctx.strokeStyle='#9dbb805c';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,240,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.restore()}
    ellipse(2,27,25,7,'#829d7038');
    const bob=!reducedMotion&&game.status==='running'&&(direction().x||direction().y)?Math.sin(game.elapsed*15)*2:0;ctx.translate(0,bob);
    roundedRect(-16,-1,32,27,10,'#416d55');ellipse(-11,25,8,4,'#3b5441');ellipse(11,25,8,4,'#3b5441');ellipse(-21,9,6,10,'#f6ddbc');ellipse(21,9,6,10,'#f6ddbc');
    ellipse(0,-16,23,23,'#fae2bb');ellipse(-7,-18,2.1,2.6,'#3c5541');ellipse(7,-18,2.1,2.6,'#3c5541');ellipse(-13,-9,4,2,'#e9b595');ellipse(13,-9,4,2,'#e9b595');ctx.strokeStyle='#597154';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,-10,4,0,Math.PI);ctx.stroke();
    ctx.fillStyle='#537b58';ctx.beginPath();ctx.ellipse(0,-32,23,12,0,Math.PI,Math.PI*2);ctx.fill();roundedRect(-25,-34,50,7,3,'#5d855f');ellipse(5,-42,3,3,'#d9d9a1');
    ctx.strokeStyle='#dec286';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-11,-1);ctx.lineTo(16,18);ctx.stroke();roundedRect(7,9,21,18,5,'#e1bf7c');roundedRect(11,12,13,6,2,'#f0dca4');
    if(p.carry){const color={rest:'#d6a55f',plan:'#90a880',talk:'#af98ac'}[p.carry];roundedRect(-19,-93,38,38,10,color);drawSupplyIcon(p.carry,0,-73,.85);text('携带中',0,-110,16,'#74856c')}
    if(p.slowTimer>0){ctx.strokeStyle='#c8b990';ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,35,0,Math.PI*2);ctx.stroke()}
    if(game.holdProgress>0){ctx.strokeStyle='#779960';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,-4,37,-Math.PI/2,-Math.PI/2+game.holdProgress*Math.PI*2);ctx.stroke()}
    ctx.restore();
    if(mode==='home')text('你的小信使 →',p.x-109,p.y,19,'#778967');
  }
  function draw() {
    ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#dce9df';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.setTransform(viewport.scale,0,0,viewport.scale,viewport.x,viewport.y);
    drawIsland(); drawLighthouse();
    if(mode==='play'&&game.status==='running'){
      const context=game.getContext();
      const target=[...game.supplies,...game.npcs,...game.dropped].find(t=>t.id===context.targetId);
      if(target){ctx.strokeStyle='#6d96698a';ctx.lineWidth=3;ctx.setLineDash([6,6]);ctx.beginPath();ctx.ellipse(target.x,target.y+28,56,17,0,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);}
    }
    for(const s of game.supplies) drawSupply(s);
    for(const drop of game.dropped) drawDropped(drop);
    // Depth sorting keeps the courier visible when passing in front of friends.
    const actors=[...game.npcs.map(n=>({y:n.y,draw:()=>drawNpc(n)})),...game.obstacles.map(c=>({y:c.y,draw:()=>drawCloud(c)})),{y:game.player.y,draw:drawPlayer}];
    actors.sort((a,b)=>a.y-b.y).forEach(a=>a.draw());
    for(let i=particles.length-1;i>=0;i--){const p=particles[i];ctx.globalAlpha=Math.max(0,1-p.age/p.life);ctx.fillStyle=p.color;ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1}
    for(let i=floaters.length-1;i>=0;i--){const f=floaters[i];ctx.globalAlpha=Math.max(0,1-f.age/f.life);ctx.fillStyle=f.color;ctx.font='600 24px "Microsoft YaHei",sans-serif';ctx.textAlign='center';ctx.fillText(f.text,f.x,f.y-f.age*(reducedMotion?0:25));ctx.globalAlpha=1}
  }

  function frame(now) {
    const realDelta = Math.max(0, (now - lastFrame) / 1000); lastFrame = now;
    const dt = Math.min(.1, realDelta);
    if (mode === 'play' && $('countdown').hidden && (game.status === 'running' || game.status === 'paused')) {
      const input = direction();
      // Consume real elapsed time in small steps, including slow frames.
      let pending = game.mode === 'timed' ? Math.min(realDelta, game.remaining) : realDelta;
      while (pending > .000001 && game.status === 'running') {
        const step = Math.min(.05, pending);
        game.update(step, { ...input, holding: spaceDown }); pending -= step;
      }
      processEvents(); updateHud();
    }
    for(let i=particles.length-1;i>=0;i--){particles[i].age+=dt;if(particles[i].age>particles[i].life)particles.splice(i,1)}
    for(let i=floaters.length-1;i>=0;i--){floaters[i].age+=dt;if(floaters[i].age>floaters[i].life)floaters.splice(i,1)}
    draw(); requestAnimationFrame(frame);
  }

  $('start-btn').addEventListener('click', () => openDialog($('tutorial-dialog')));
  $('howto-btn').addEventListener('click', () => openDialog($('tutorial-dialog')));
  function selectGameMode(nextMode) {
    if (!['timed','free'].includes(nextMode) || (mode === 'play' && game.status === 'running')) return;
    selectedGameMode = nextMode;
    if (mode === 'home') game.setMode(nextMode);
    ['timed','free'].forEach(id => {
      const button = $(id === 'timed' ? 'timed-mode-btn' : 'free-mode-btn');
      button.classList.toggle('selected', id === selectedGameMode);
      button.setAttribute('aria-pressed', String(id === selectedGameMode));
    });
    $('mode-summary').textContent = selectedGameMode === 'timed' ? '当前选择：限时体验版 · 120 秒内完成' : '当前选择：自由探索版 · 不设倒计时，慢慢完成';
    const targetCount = MoodGame.TOTAL_DELIVERIES || 5;
    $('tutorial-dialog').querySelector('.modal-intro').textContent = selectedGameMode === 'timed' ? '你有 120 秒。送达 ' + targetCount + ' 份补给，灯塔会点亮并立即结算。' : '不设倒计时。送达 ' + targetCount + ' 份补给，灯塔会点亮并立即结算；用时会用于星级参考。';
  }
  $('timed-mode-btn').addEventListener('click', () => selectGameMode('timed'));
  $('free-mode-btn').addEventListener('click', () => selectGameMode('free'));
  $('tutorial-close').addEventListener('click', () => closeDialog($('tutorial-dialog')));
  $('begin-btn').addEventListener('click', () => { closeDialog($('tutorial-dialog')); startCountdown(true); });
  $('pause-btn').addEventListener('click', togglePause); $('resume-btn').addEventListener('click', togglePause);
  $('restart-btn').addEventListener('click', openRestart); $('cancel-restart').addEventListener('click', cancelRestart);
  $('confirm-restart').addEventListener('click', () => { closeDialog($('restart-dialog')); startCountdown(true); });
  $('again-btn').addEventListener('click', () => { closeDialog($('result-dialog')); startCountdown(true); });
  $('home-btn').addEventListener('click', showHome);
  $('sound-btn').addEventListener('click', () => setSound(!soundOn)); $('motion-btn').addEventListener('click', () => setReducedMotion(!reducedMotion)); $('fullscreen-btn').addEventListener('click', enterFullscreen); $('skill-btn').addEventListener('click', () => { if (game.useSkill()) processEvents(); });
  $('pause-shade').addEventListener('click', event => { if (event.target === $('pause-shade')) togglePause(); });
  $('tutorial-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog($('tutorial-dialog')); });
  $('restart-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelRestart(); });
  $('result-dialog').addEventListener('cancel', event => { event.preventDefault(); });
  canvas.addEventListener('pointerdown', () => canvas.focus());

  document.addEventListener('fullscreenchange', () => { $('fullscreen-btn').querySelector('span').textContent = document.fullscreenElement ? '退出全屏' : '全屏体验'; resizeCanvas(); });
  setSound(false); setReducedMotion(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false); selectGameMode('timed'); resizeCanvas(); game.reset({ mode: selectedGameMode }); updateHud(); draw(); requestAnimationFrame(frame);
})();
