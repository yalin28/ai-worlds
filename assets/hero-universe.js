// A small, dependency-free 3D particle scene, projected onto a transparent canvas.
(() => {
  const container = document.querySelector('[data-hero-universe]');
  if (!container) return;
  const canvas = container.querySelector('canvas');
  const hero = container.closest('.home-hero');
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const contrast = window.matchMedia('(forced-colors: active)');
  const compact = window.matchMedia('(max-width: 52rem), (pointer: coarse)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let context;
  try {
    context = canvas.getContext('2d', { alpha: true });
  } catch {
    return;
  }
  if (!context) return;

  const scene = createUniverseScene(canvas, context);
  let visible = !('IntersectionObserver' in window);
  let frame = null;
  let lastTime = 0;
  let elapsed = 0;
  let slowFrames = 0;
  let economy = false;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let contextAvailable = true;
  const pointer = { active: false, clientX: 0, clientY: 0, x: 0, y: 0, velocityX: 0, velocityY: 0 };
  const canFollowPointer = () => finePointer.matches && !compact.matches && !motion.matches;
  const shouldAnimate = () => contextAvailable && visible && !document.hidden && !motion.matches && !contrast.matches;

  const resetPointer = () => { pointer.active = false; };
  const updatePointer = (delta) => {
    let targetX = 0;
    let targetY = 0;
    const following = pointer.active && canFollowPointer();
    if (following) {
      // Read layout once per rendered frame, never for each pointer event.
      const rect = hero.getBoundingClientRect();
      if (rect.width && rect.height) {
        targetX = Math.max(-1, Math.min(1, (pointer.clientX - rect.left) / rect.width * 2 - 1));
        targetY = Math.max(-1, Math.min(1, (pointer.clientY - rect.top) / rect.height * 2 - 1));
      }
    }
    // Critical damping preserves velocity on exit; the slower return avoids a sudden reversal.
    const speed = following ? 16 : 6;
    const seconds = delta / 1000;
    const decay = Math.exp(-speed * seconds);
    const offsetX = pointer.x - targetX;
    const offsetY = pointer.y - targetY;
    const stepX = (pointer.velocityX + speed * offsetX) * seconds;
    const stepY = (pointer.velocityY + speed * offsetY) * seconds;
    pointer.x = targetX + (offsetX + stepX) * decay;
    pointer.y = targetY + (offsetY + stepY) * decay;
    pointer.velocityX = (pointer.velocityX - speed * stepX) * decay;
    pointer.velocityY = (pointer.velocityY - speed * stepY) * decay;
    // A fast inward flick should settle at neutral instead of crossing it and rebounding.
    if (!following && pointer.x * offsetX <= 0) {
      pointer.x = 0;
      pointer.velocityX = 0;
    }
    if (!following && pointer.y * offsetY <= 0) {
      pointer.y = 0;
      pointer.velocityY = 0;
    }
  };

  const draw = () => {
    if (!contextAvailable) return;
    scene.draw(elapsed, pointer.x, pointer.y);
    container.classList.add('is-ready');
  };
  const resize = () => {
    const rect = container.getBoundingClientRect();
    const nextRatio = Math.min(window.devicePixelRatio || 1, economy ? 1 : compact.matches ? 1.5 : 2);
    if (!rect.width || !rect.height) return;
    if (width === rect.width && height === rect.height && pixelRatio === nextRatio) return;
    width = rect.width;
    height = rect.height;
    pixelRatio = nextRatio;
    scene.resize(width, height, pixelRatio, economy ? 1200 : compact.matches ? 2400 : 3600);
    draw();
  };
  const tick = (now) => {
    frame = null;
    if (!shouldAnimate()) return;
    if (!lastTime) lastTime = now;
    const delta = now - lastTime;
    // 30 fps is ample for a slow orbit, including on high-refresh-rate phones.
    if (delta >= 1000 / 30 - 1) {
      elapsed += Math.min(delta, 80) / 1000;
      lastTime = now;
      const start = performance.now();
      updatePointer(Math.min(delta, 80));
      draw();
      slowFrames = performance.now() - start > 10 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
      if (slowFrames >= 12 && !economy) {
        economy = true;
        resize();
      }
    }
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastTime = 0;
    if (!shouldAnimate() || !canFollowPointer()) {
      resetPointer();
      pointer.velocityX = 0;
      pointer.velocityY = 0;
    }
    if (!canFollowPointer() && (pointer.x || pointer.y)) {
      pointer.x = 0;
      pointer.y = 0;
      if (visible && !document.hidden && !contrast.matches) draw();
    }
    if (shouldAnimate()) frame = requestAnimationFrame(tick);
  };
  hero.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || !canFollowPointer() || !shouldAnimate()) return;
    pointer.active = true;
    pointer.clientX = event.clientX;
    pointer.clientY = event.clientY;
  }, { passive: true });
  hero.addEventListener('pointerleave', resetPointer);
  hero.addEventListener('pointercancel', resetPointer);
  window.addEventListener('blur', resetPointer);
  motion.addEventListener('change', sync);
  contrast.addEventListener('change', sync);
  compact.addEventListener('change', () => {
    resize();
    sync();
  });
  finePointer.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pagehide', () => {
    resetPointer();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  });
  window.addEventListener('pageshow', sync);
  window.addEventListener('resize', resize, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(container);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    }).observe(container);
  }

  resize();
  sync();
})();

function createUniverseScene(canvas, context) {
  const TAU = Math.PI * 2;
  // 对角倾斜约 23 度，比先前的 33 度略收，让球体更端正
  const tilt = -0.4;
  const inclination = 0.31;
  const radius = 0.8;
  let seed = 2819;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // 生成环带密集流金粒子：按多层晶体环带轨道分布
  const dust = Array.from({ length: 4200 }, (_, index) => {
    const spread = random();
    let distance;
    // 75% 的粒子聚集在主亮金环 (1.48 ~ 2.14)，其余分布在内环与外层折射倒角环
    if (index % 10 < 7) {
      distance = 1.48 + Math.pow(spread, 0.85) * 0.66;
    } else if (index % 10 < 9) {
      distance = 1.15 + spread * 0.32;
    } else {
      distance = 2.22 + spread * 0.28;
    }
    return {
      angle: (index % 5) * (TAU / 5) + distance * 2.8 + (random() - 0.5) * 0.9,
      radius: distance,
      speed: 0.08 / Math.pow(distance, 1.5),
      lift: (random() - 0.5) * (index % 6 ? 0.035 : 0.12),
      size: 0.4 + Math.pow(random(), 2.8) * 1.5,
      shade: Math.floor(random() * 8),
      phase: random() * TAU,
      twinkleSpeed: 1.5 + random() * 3.5,
      isSparkle: random() < 0.12,
    };
  });

  // 生成深空背景星芒点
  const stars = Array.from({ length: 90 }, () => ({
    x: (random() - 0.5) * 5.2,
    y: (random() - 0.5) * 3.4,
    size: 0.35 + random() * 0.8,
    phase: random() * TAU,
    speed: 0.4 + random() * 0.8,
    hue: random() > 0.4 ? 'gold' : 'cyan',
  }));

  // 球国内部的流光星尘旋涡核心（呈现水晶球内部的微距宇宙感）
  const coreNebula = Array.from({ length: 720 }, () => {
    const d = Math.pow(random(), 0.7) * 0.82;
    const spiral = random() * TAU;
    return {
      r: d,
      spiralAngle: spiral,
      elevation: (random() - 0.5) * 0.65 * (1 - d * 0.5),
      speed: 0.04 + (1 - d) * 0.06,
      size: 0.35 + Math.pow(random(), 2) * 1.1,
      shade: Math.floor(random() * 5),
    };
  });

  // 球面三维采样点（辅助表面立体感）
  const surface = Array.from({ length: 800 }, () => ({
    angle: random() * TAU,
    latitude: Math.acos(random() * 2 - 1),
    size: 0.3 + random() * 0.6,
  }));

  // 粒子色谱库：深琥珀金、晶灿金、亮金、香槟白、钻石白与冷折射蓝白
  const colors = [
    'rgba(215, 145, 48, 0.85)',
    'rgba(238, 172, 65, 0.95)',
    'rgba(255, 205, 88, 1)',
    'rgba(255, 228, 145, 1)',
    'rgba(255, 248, 220, 1)',
    'rgba(255, 255, 255, 1)',
    'rgba(200, 235, 255, 0.95)',
    'rgba(255, 215, 110, 0.7)',
  ];

  // 预渲染粒子雪碧图与钻石闪烁星芒
  const dustSprite = document.createElement('canvas');
  const spriteSize = 20;
  dustSprite.width = spriteSize * (colors.length + 2);
  dustSprite.height = spriteSize;
  const spriteContext = dustSprite.getContext('2d');
  colors.forEach((color, index) => {
    const cx = (index + 0.5) * spriteSize;
    const cy = spriteSize / 2;
    // 柔化光晕点
    const g = spriteContext.createRadialGradient(cx, cy, 0, cx, cy, spriteSize / 2);
    g.addColorStop(0, color);
    g.addColorStop(0.65, color);
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    spriteContext.fillStyle = g;
    spriteContext.beginPath();
    spriteContext.arc(cx, cy, spriteSize / 2, 0, TAU);
    spriteContext.fill();
  });

  // 绘制钻石十字星芒粒子（用于高光闪烁粒子）
  const drawStarSprite = (offsetIndex, baseColor, glowColor) => {
    const cx = (colors.length + offsetIndex + 0.5) * spriteSize;
    const cy = spriteSize / 2;
    spriteContext.save();
    spriteContext.translate(cx, cy);
    // 外层微光
    const rg = spriteContext.createRadialGradient(0, 0, 0, 0, 0, spriteSize / 2);
    rg.addColorStop(0, glowColor);
    rg.addColorStop(1, 'rgba(255, 255, 255, 0)');
    spriteContext.fillStyle = rg;
    spriteContext.beginPath();
    spriteContext.arc(0, 0, spriteSize / 2, 0, TAU);
    spriteContext.fill();
    // 十字芒刃
    spriteContext.fillStyle = baseColor;
    spriteContext.fillRect(-0.75, -spriteSize / 2 + 2, 1.5, spriteSize - 4);
    spriteContext.fillRect(-spriteSize / 2 + 2, -0.75, spriteSize - 4, 1.5);
    spriteContext.restore();
  };
  drawStarSprite(0, 'rgba(255, 255, 255, 1)', 'rgba(255, 220, 130, 0.7)');
  drawStarSprite(1, 'rgba(240, 250, 255, 1)', 'rgba(120, 200, 255, 0.6)');

  const buckets = Array.from({ length: 16 }, () => []);
  const positions = new Float32Array(dust.length * 4);
  const globe = document.createElement('canvas');
  let width = 0;
  let height = 0;
  let scale = 1;
  let dpr = 1;
  let count = dust.length;
  let inverseRadiusSquared = 1;

  // 光学玻璃折射放大率计算
  const glassMagnification = (x, y) => {
    const interior = 1 - (x * x + y * y) * inverseRadiusSquared;
    return interior > 0 ? 1 + 0.28 * Math.pow(interior, 1.4) : 1;
  };

  // 生成烘焙的高透光学水晶球壳：锐利菲涅尔光环、多层折射厚度与耀斑高光
  const makeGlobe = () => {
    const size = Math.ceil(radius * scale * dpr * 2);
    if (size <= 0) return;
    globe.width = size;
    globe.height = size;
    const ctx = globe.getContext('2d');
    const pixels = ctx.createImageData(size, size);

    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const nx = ((x + 0.5) / size) * 2 - 1;
        const ny = ((y + 0.5) / size) * 2 - 1;
        const distance = nx * nx + ny * ny;
        if (distance > 1) continue;
        const edge = Math.sqrt(distance);
        const nz = Math.sqrt(1 - distance);

        // 菲涅尔边缘光：极具晶莹质感的薄壁高光
        const fresnel = Math.pow(1 - nz, 6.2);
        const lightDot = Math.max(0, (-nx * 0.68 - ny * 0.73) / Math.max(edge, 0.001));
        const light = Math.pow(lightDot, 8);
        const outerRim = Math.exp(-Math.pow((edge - 0.993) / 0.005, 2)) * 0.55;
        const innerRim = Math.exp(-Math.pow((edge - 0.91) / 0.035, 2)) * 0.42;
        // 左上方强烈镜面耀斑聚光
        const specularSpot = Math.exp(-Math.pow((nx + 0.38) / 0.2, 2) - Math.pow((ny + 0.46) / 0.12, 2)) * 0.88;
        // 右下方金环环境反光（模拟下方金环映照在水晶球底部的琥珀暖光）
        const ringWarmth = Math.exp(-Math.pow((nx - 0.24) / 0.42, 2) - Math.pow((ny - 0.38) / 0.26, 2)) * 0.32;
        // 球体表面的玻璃折射微条纹
        const sheenRibbon = Math.exp(-Math.pow((ny + 0.28 + nx * 0.36 + nx * nx * 0.25) / 0.065, 2)) * 0.25;

        // 基础半透明度与高光融合
        const coldShine = Math.min(1, light * 0.98 + outerRim * 0.92 + specularSpot * 1.05 + sheenRibbon);
        const warmShine = ringWarmth * 1.05;
        const baseAlpha = 0.015 + fresnel * 0.1 + innerRim * 0.1;
        const coldAlpha = coldShine * 0.68;
        const warmAlpha = warmShine * 0.22;
        const baseWeight = baseAlpha * (1 - coldAlpha) * (1 - warmAlpha);
        const coldWeight = coldAlpha * (1 - warmAlpha);
        const alpha = baseWeight + coldWeight + warmAlpha;

        // ImageData 使用非预乘颜色，按最终透明度还原亮色，避免低透明区域叠出黑色外皮。
        const rVal = (211 * baseWeight + 252 * coldWeight + 255 * warmAlpha) / alpha;
        const gVal = (231 * baseWeight + 254 * coldWeight + 231 * warmAlpha) / alpha;
        const bVal = (246 * baseWeight + 255 * coldWeight + 180 * warmAlpha) / alpha;

        const offset = (y * size + x) * 4;
        pixels.data[offset] = rVal;
        pixels.data[offset + 1] = gVal;
        pixels.data[offset + 2] = bVal;
        // 抗锯齿边缘衰减
        pixels.data[offset + 3] = alpha * Math.min(1, (1 - edge) * size * 0.75) * 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
  };

  // 绘制同心晶体光环带结构与发光槽
  const ring = (front, viewTilt, viewInclination) => {
    context.save();
    context.rotate(viewTilt);
    context.save();
    context.scale(1, viewInclination);

    // 主环流金光晕渐变
    const glow = context.createRadialGradient(0, 0, scale * 1.1, 0, 0, scale * 2.5);
    glow.addColorStop(0, 'rgba(235, 175, 70, 0)');
    glow.addColorStop(0.12, 'rgba(235, 180, 80, 0.03)');
    glow.addColorStop(0.42, 'rgba(245, 195, 95, 0.16)');
    glow.addColorStop(0.72, 'rgba(235, 180, 80, 0.08)');
    glow.addColorStop(1, 'rgba(235, 180, 80, 0)');
    context.fillStyle = glow;
    context.beginPath();
    context.arc(0, 0, scale * 2.5, front ? 0 : Math.PI, front ? Math.PI : TAU);
    context.closePath();
    context.fill();
    context.restore();

    // 绘制晶体盘边缘倒角线（包括内槽、主槽与外圈晶体边）
    const orbits = [
      { r: 1.24, primary: false, w: 0.45 },
      { r: 1.62, primary: true, w: 0.65 },
      { r: 2.03, primary: true, w: 0.6 },
      { r: 2.42, primary: false, w: 0.28 },
    ];

    orbits.forEach(({ r, primary, w }) => {
      context.beginPath();
      if (front) {
        context.ellipse(0, 0, r * scale, r * scale * viewInclination, 0, 0.06, Math.PI - 0.06);
      } else {
        // 后环穿过水晶球时经过光学折射
        for (let step = 0; step <= 96; step += 1) {
          const angle = Math.PI + 0.06 + ((Math.PI - 0.12) * step) / 96;
          const x = Math.cos(angle) * r * scale;
          const y = Math.sin(angle) * r * scale * viewInclination;
          const lens = glassMagnification(x, y);
          if (step === 0) context.moveTo(x * lens, y * lens);
          else context.lineTo(x * lens, y * lens);
        }
      }
      context.strokeStyle = primary ? 'rgba(238, 182, 75, 0.78)' : 'rgba(215, 175, 95, 0.42)';
      context.lineWidth = w;
      context.stroke();

      if (primary) {
        context.strokeStyle = 'rgba(255, 248, 220, 0.7)';
        context.lineWidth = w * 0.22;
        context.stroke();
      }
    });

    context.restore();
  };

  // 绘制环带粒子与星芒闪烁
  const drawDust = (front) => {
    for (let shade = 0; shade < colors.length; shade += 1) {
      const bucket = buckets[shade + (front ? 8 : 0)];
      for (let i = 0; i < bucket.length; i += 1) {
        const offset = bucket[i] * 4;
        const x = positions[offset];
        const y = positions[offset + 1];
        const size = positions[offset + 2];
        const isSparkle = positions[offset + 3] > 0.5;

        if (isSparkle && size > 1.2) {
          // 渲染十字钻石星芒
          const spriteCol = shade % 2 === 0 ? colors.length : colors.length + 1;
          const drawSz = size * 2.8;
          context.drawImage(dustSprite, spriteCol * spriteSize, 0, spriteSize, spriteSize, x - drawSz / 2, y - drawSz / 2, drawSz, drawSz);
        } else {
          // 渲染微粒圆点
          context.drawImage(dustSprite, shade * spriteSize, 0, spriteSize, spriteSize, x - size / 2, y - size / 2, size, size);
        }
      }
    }
  };

  // 绘制水晶球左上方标志性耀斑与星芒（Lens Flare）
  const drawLensFlare = (fx, fy, baseScale) => {
    context.save();
    context.translate(fx, fy);

    // 水平/对角变形蓝白宽光刃条
    const streakLength = 85 * baseScale;
    const streakHeight = 2.4 * baseScale;
    const hStreak = context.createLinearGradient(-streakLength, 0, streakLength, 0);
    hStreak.addColorStop(0, 'rgba(80, 160, 255, 0)');
    hStreak.addColorStop(0.35, 'rgba(100, 190, 255, 0.4)');
    hStreak.addColorStop(0.5, 'rgba(255, 255, 255, 1)');
    hStreak.addColorStop(0.65, 'rgba(100, 190, 255, 0.4)');
    hStreak.addColorStop(1, 'rgba(80, 160, 255, 0)');
    context.fillStyle = hStreak;
    context.fillRect(-streakLength, -streakHeight / 2, streakLength * 2, streakHeight);

    // 45度辅助光芒
    context.save();
    context.rotate(Math.PI / 4);
    const subStreak = context.createLinearGradient(-streakLength * 0.45, 0, streakLength * 0.45, 0);
    subStreak.addColorStop(0, 'rgba(120, 200, 255, 0)');
    subStreak.addColorStop(0.5, 'rgba(255, 255, 255, 0.75)');
    subStreak.addColorStop(1, 'rgba(120, 200, 255, 0)');
    context.fillStyle = subStreak;
    context.fillRect(-streakLength * 0.45, -streakHeight * 0.4, streakLength * 0.9, streakHeight * 0.8);
    context.restore();

    // 核心微光晕球
    const flareGlow = context.createRadialGradient(0, 0, 0, 0, 0, 18 * baseScale);
    flareGlow.addColorStop(0, 'rgba(255, 255, 255, 1)');
    flareGlow.addColorStop(0.2, 'rgba(200, 235, 255, 0.85)');
    flareGlow.addColorStop(0.5, 'rgba(80, 170, 255, 0.3)');
    flareGlow.addColorStop(1, 'rgba(60, 140, 255, 0)');
    context.fillStyle = flareGlow;
    context.beginPath();
    context.arc(0, 0, 18 * baseScale, 0, TAU);
    context.fill();

    context.restore();
  };

  return {
    resize(nextWidth, nextHeight, ratio, particles) {
      width = nextWidth;
      height = nextHeight;
      dpr = ratio;
      count = Math.min(dust.length, particles);
      scale = Math.min(width / 5.15, height / 3.55);
      inverseRadiusSquared = 1 / Math.pow(radius * scale, 2);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      makeGlobe();
    },
    draw(time, viewX = 0, viewY = 0) {
      if (scale <= 0 || width <= 0 || height <= 0) return;
      const viewTilt = tilt + viewX * 0.085;
      const viewInclination = inclination + viewY * 0.085;
      const cosTilt = Math.cos(viewTilt);
      const sinTilt = Math.sin(viewTilt);

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.translate(width / 2, height / 2);

      context.translate(viewX * scale * 0.075, viewY * scale * 0.045);

      // 3. 计算流金粒子三维投影与折射变换
      buckets.forEach((bucket) => {
        bucket.length = 0;
      });
      for (let i = 0; i < count; i += 1) {
        const p = dust[i];
        const angle = p.angle + time * p.speed;
        const x = Math.cos(angle) * p.radius;
        const orbitY = Math.sin(angle) * p.radius;
        const y = orbitY * viewInclination + p.lift;
        const perspective = 1 / (1 - orbitY * 0.035);
        const offset = i * 4;

        const projectedX = (x * cosTilt - y * sinTilt) * scale * perspective;
        const projectedY = (x * sinTilt + y * cosTilt) * scale * perspective;
        const lens = orbitY < 0 ? glassMagnification(projectedX, projectedY) : 1;

        // 闪烁亮度波动
        const twinkle = Math.sin(time * p.twinkleSpeed + p.phase) * 0.4 + 0.6;

        positions[offset] = projectedX * lens;
        positions[offset + 1] = projectedY * lens;
        positions[offset + 2] = p.size * (0.8 + scale / 140) * perspective * lens * twinkle;
        positions[offset + 3] = p.isSparkle && twinkle > 0.85 ? 1 : 0;

        buckets[p.shade + (orbitY > 0 ? 8 : 0)].push(i);
      }

      // 4. 绘制后环带与后半部分流金微粒
      ring(false, viewTilt, viewInclination);
      drawDust(false);

      const r = radius * scale;

      // 5. 绘制水晶球内部流光星尘核心（受球体蒙版约束并具备三维透视）
      context.save();
      context.beginPath();
      context.arc(0, 0, r * 0.98, 0, TAU);
      context.clip();

      // 淡蓝白的透明底质，保留内部星尘与后环的透光感。
      const sphereInterior = context.createRadialGradient(0, 0, 0, 0, 0, r);
      sphereInterior.addColorStop(0, 'rgba(205, 225, 242, 0.1)');
      sphereInterior.addColorStop(0.6, 'rgba(215, 234, 248, 0.08)');
      sphereInterior.addColorStop(0.82, 'rgba(227, 241, 252, 0.05)');
      sphereInterior.addColorStop(1, 'rgba(240, 249, 255, 0.02)');
      context.fillStyle = sphereInterior;
      context.fill();

      // 内部核心金色星云气旋
      context.save();
      context.rotate(viewTilt * 0.8 + time * 0.02);
      const coreGlow = context.createRadialGradient(0, 0, 0, 0, 0, r * 0.72);
      coreGlow.addColorStop(0, 'rgba(255, 235, 150, 0.52)');
      coreGlow.addColorStop(0.35, 'rgba(240, 178, 65, 0.32)');
      coreGlow.addColorStop(0.7, 'rgba(218, 167, 69, 0.08)');
      coreGlow.addColorStop(1, 'rgba(255, 235, 150, 0)');
      context.fillStyle = coreGlow;
      context.beginPath();
      context.scale(1.2, 0.65);
      context.arc(0, 0, r * 0.72, 0, TAU);
      context.fill();
      context.restore();

      // 绘制球体内部旋涡粒子
      context.save();
      context.rotate(viewTilt);
      const sinPitch = Math.sin(viewY * 0.12);
      const cosPitch = Math.cos(viewY * 0.12);
      for (const pt of coreNebula) {
        const curAngle = pt.spiralAngle + time * pt.speed + viewX * 0.15;
        const px = Math.cos(curAngle) * pt.r * r;
        const pyOrbit = Math.sin(curAngle) * pt.r * r;
        const py = pyOrbit * inclination + pt.elevation * r;
        const pz = -Math.sin(curAngle) * pt.r;
        const depth = pz * sinPitch + cosPitch;
        if (depth < 0.15) continue;

        const spriteIndex = pt.shade;
        const sz = pt.size * (0.8 + depth * 0.6);
        context.drawImage(dustSprite, spriteIndex * spriteSize, 0, spriteSize, spriteSize, px - sz / 2, py - sz / 2, sz, sz);
      }

      // 球面反射粒子（增强球体旋转的微粒反射）
      context.fillStyle = 'rgba(240, 250, 255, 0.75)';
      context.beginPath();
      for (const point of surface) {
        const angle = point.angle + time * 0.03 + viewX * 0.14;
        const sphereY = Math.cos(point.latitude);
        const sphereZ = Math.sin(point.latitude) * Math.cos(angle);
        const z = sphereY * sinPitch + sphereZ * cosPitch;
        if (z < 0.18) continue;
        const x = Math.sin(point.latitude) * Math.sin(angle) * r;
        const y = (sphereY * cosPitch - sphereZ * sinPitch) * r;
        context.rect(x, y, point.size * z, point.size * z);
      }
      context.fill();
      context.restore();
      context.restore();

      // 6. 绘制高透光学水晶球壳（覆于内部粒子之上，呈现清澈高光与菲涅尔镜面晶壁）
      context.save();
      context.rotate(viewX * 0.035 + viewY * 0.025);
      context.drawImage(globe, -r, -r, r * 2, r * 2);
      context.restore();

      // 7. 绘制前环带与前半部分流金微粒（穿过球体前方）
      ring(true, viewTilt, viewInclination);
      drawDust(true);

      // 8. 绘制水晶球左上角标志性耀斑与星芒（顶级点睛之笔）
      const flareX = -r * 0.42 + viewX * 4;
      const flareY = -r * 0.54 + viewY * 4;
      drawLensFlare(flareX, flareY, scale / 140);
    },
  };
}

(() => {
  const canvas = document.querySelector('[data-hero-rain]');
  if (!canvas) return;
  const hero = canvas.closest('.home-hero');
  if (!hero) return;
  let context;
  try {
    context = canvas.getContext('2d', { alpha: true });
  } catch {
    return;
  }
  if (!context) return;

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const contrast = window.matchMedia('(forced-colors: active)');
  const compact = window.matchMedia('(max-width: 52rem), (pointer: coarse)');
  const glyphs = '01{}<>=/+$#&|~%^[]()!?;:_.abcdefghijklmnopqrstuvwxyz';
  const fontFamily = 'SFMono-Regular, Consolas, "Liberation Mono", monospace';
  const pointer = { x: -9999, y: -9999 };
  const columns = [];
  let visible = !('IntersectionObserver' in window);
  let frame = null;
  let lastTime = 0;
  let width = 0;
  let height = 0;
  let pixelRatio = 0;
  let columnWidth = 18;
  let fontSize = 13;
  let trail = 10;

  const glyphAt = (index) => glyphs[(index % glyphs.length + glyphs.length) % glyphs.length];
  const shouldAnimate = () => visible && !document.hidden && !motion.matches && !contrast.matches;
  const seedColumns = () => {
    columnWidth = compact.matches ? 22 : 18;
    fontSize = compact.matches ? 12 : 13;
    trail = compact.matches ? 7 : 10;
    const count = Math.max(8, Math.floor(width / columnWidth));
    columns.length = 0;
    for (let i = 0; i < count; i += 1) {
      const length = trail + Math.floor(Math.random() * 5);
      columns.push({
        offset: Math.floor(Math.random() * glyphs.length),
        y: Math.random() * height,
        speed: 24 + Math.random() * 58,
        length,
      });
    }
  };
  const drawGlyphs = (animated) => {
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.font = `${fontSize}px ${fontFamily}`;
    context.textBaseline = 'top';
    columns.forEach((column, index) => {
      const x = index * columnWidth + 3;
      for (let step = 0; step < column.length; step += 1) {
        const y = animated ? column.y - step * fontSize : (step * fontSize * 2 + index * 11) % height;
        if (y < -fontSize || y > height) continue;
        const near = Math.abs(x - pointer.x) < 120 && Math.abs(y - pointer.y) < 140;
        const head = step === 0;
        const fade = 1 - step / column.length;
        let alpha;
        if (!animated) alpha = 0.05 + (index + step) % 5 * 0.015;
        else if (head) alpha = near ? 0.9 : 0.78;
        else alpha = (near ? 0.22 : 0.12) + fade * 0.28;
        context.fillStyle = near
          ? `rgba(140, 210, 255, ${alpha})`
          : head
            ? `rgba(255, 246, 220, ${alpha})`
            : `rgba(231, 196, 134, ${alpha})`;
        context.fillText(glyphAt(column.offset + step), x, y);
      }
    });
  };
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const nextRatio = Math.min(window.devicePixelRatio || 1, 2);
    if (!rect.width || !rect.height) return;
    if (width === rect.width && height === rect.height && pixelRatio === nextRatio) return;
    width = rect.width;
    height = rect.height;
    pixelRatio = nextRatio;
    canvas.width = Math.round(width * pixelRatio);
    canvas.height = Math.round(height * pixelRatio);
    seedColumns();
    drawGlyphs(shouldAnimate());
  };
  const tick = (now) => {
    frame = null;
    if (!shouldAnimate()) return;
    if (!lastTime) lastTime = now;
    const delta = now - lastTime;
    if (delta >= 40 - 1) {
      lastTime = now;
      const seconds = Math.min(delta, 100) / 1000;
      columns.forEach((column) => {
        column.y += column.speed * seconds;
        if (column.y - column.length * fontSize > height) {
          column.y = -Math.random() * 120;
          column.speed = 24 + Math.random() * 58;
          column.offset = Math.floor(Math.random() * glyphs.length);
          column.length = trail + Math.floor(Math.random() * 5);
        } else if (Math.random() < 0.03) {
          column.offset += 1;
        }
      });
      drawGlyphs(true);
    }
    frame = requestAnimationFrame(tick);
  };
  const sync = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    lastTime = 0;
    if (motion.matches || contrast.matches) {
      if (width && height) drawGlyphs(false);
      return;
    }
    if (shouldAnimate()) frame = requestAnimationFrame(tick);
  };

  hero.addEventListener('pointermove', (event) => {
    if (event.pointerType !== 'mouse' || !shouldAnimate()) return;
    const rect = canvas.getBoundingClientRect();
    pointer.x = event.clientX - rect.left;
    pointer.y = event.clientY - rect.top;
  }, { passive: true });
  hero.addEventListener('pointerleave', () => {
    pointer.x = -9999;
    pointer.y = -9999;
  });
  motion.addEventListener('change', () => {
    resize();
    sync();
  });
  contrast.addEventListener('change', sync);
  compact.addEventListener('change', () => {
    width = 0;
    resize();
    sync();
  });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('resize', resize, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    }, { threshold: 0.02 }).observe(canvas);
  }

  resize();
  sync();
})();
