const root = document.documentElement;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const activeAnimations = new Set();
const motionListeners = new Set();

const canAnimate = () => !reducedMotion.matches && !document.hidden;

const updateMotion = () => {
  const enabled = !reducedMotion.matches;
  root.classList.toggle('motion-enabled', enabled);
  root.classList.toggle('motion-suspended', document.hidden);
  if (!canAnimate()) {
    activeAnimations.forEach((animation) => animation.cancel());
    activeAnimations.clear();
  }
  motionListeners.forEach((sync) => sync());
};

const reveal = (elements) => {
  if (!canAnimate()) return;
  [...elements].forEach((element, index) => {
    if (!element.animate) return;
    const animation = element.animate(
      [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 520, delay: Math.min(index, 5) * 90, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' },
    );
    activeAnimations.add(animation);
    animation.onfinish = animation.oncancel = () => activeAnimations.delete(animation);
  });
};

reducedMotion.addEventListener('change', updateMotion);
document.addEventListener('visibilitychange', updateMotion);
updateMotion();
reveal(document.querySelectorAll('[data-enter]'));

if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting);
    reveal(visible.map((entry) => entry.target));
    visible.forEach((entry) => observer.unobserve(entry.target));
  }, { threshold: 0.12 });
  document.querySelectorAll('[data-reveal]').forEach((element) => observer.observe(element));
}

const gallery = document.querySelector('[data-world-gallery]');

if (gallery) {
  const switcher = gallery.querySelector('[data-world-switch]');
  const select = gallery.querySelector('#world-type');
  const panels = [...gallery.querySelectorAll('[data-world-panel]')];
  const status = gallery.querySelector('[data-world-status]');
  const defaultPanel = panels.find((panel) => panel.id === 'self-world');
  let currentPanel = null;

  const showWorld = (id, announce = false) => {
    const selected = panels.find((panel) => panel.id === id) || defaultPanel;
    panels.forEach((panel) => {
      panel.hidden = panel !== selected;
    });
    select.value = selected.id;
    if (currentPanel !== selected) {
      currentPanel = selected;
      reveal(selected.querySelectorAll('.world-card'));
    }
    if (announce) {
      const count = selected.querySelectorAll('.world-card__link').length;
      status.textContent = `已显示${selected.dataset.label}，共 ${count} 个作品。`;
    }
  };

  const syncFromLocation = () => {
    const id = window.location.hash.slice(1);
    // In-page links such as "skip to content" keep the current collection.
    const target = panels.some((panel) => panel.id === id) ? id : (id ? currentPanel?.id : defaultPanel.id);
    showWorld(target);
  };

  select.addEventListener('change', () => {
    showWorld(select.value, true);
    // Keep the selected collection in the URL without scrolling past the selector.
    try {
      const url = new URL(window.location.href);
      url.hash = select.value;
      window.history.pushState(null, '', url);
    } catch {
      // Local-file restrictions must not prevent collection switching.
    }
  });

  window.addEventListener('popstate', syncFromLocation);
  window.addEventListener('hashchange', syncFromLocation);
  window.addEventListener('pageshow', syncFromLocation);
  syncFromLocation();
  switcher.hidden = false;
}

document.querySelectorAll('[data-prompt]').forEach((container) => {
  const button = container.querySelector('[data-copy-prompt]');
  const source = container.querySelector('[data-prompt-text]');
  const status = container.querySelector('[data-copy-status]');
  const label = button?.querySelector('[data-copy-label]');
  if (!button || !source || !status) return;
  let resetTimer;

  const fallbackCopy = (text) => {
    const field = document.createElement('textarea');
    field.value = text;
    field.readOnly = true;
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.append(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    field.remove();
    button.focus({ preventScroll: true });
    return copied;
  };

  button.addEventListener('click', async () => {
    const text = source.textContent.trim();
    status.textContent = '';
    window.clearTimeout(resetTimer);
    button.classList.remove('is-copied');
    const setName = (name) => {
      button.setAttribute('aria-label', name);
      if (label) label.textContent = name;
    };
    setName('复制提示词');
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = fallbackCopy(text);
    }
    status.textContent = copied ? '已复制' : '复制失败，请重试或手动选择下方提示词。';
    setName(copied ? '已复制' : '重试复制');
    if (copied) {
      button.classList.add('is-copied');
      resetTimer = window.setTimeout(() => {
        button.classList.remove('is-copied');
        setName('复制提示词');
      }, 2200);
    }
  });
});

// Keep the title animation in sync with reduced motion and page visibility.
const hero = document.querySelector('.home-hero');
if (hero) {
  const syncTyping = initTypewriter(hero.querySelector('[data-typewriter]'));
  let visible = !('IntersectionObserver' in window);
  const syncHero = () => {
    const enabled = visible && canAnimate();
    syncTyping(enabled);
  };
  motionListeners.add(syncHero);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      hero.classList.toggle('is-offscreen', !visible);
      syncHero();
    }).observe(hero);
  }
  syncHero();
}


function initTypewriter(container) {
  if (!container) return () => {};
  const lines = [...container.querySelectorAll('[data-type-text]')];
  const texts = lines.map((line) => [...line.textContent]);
  const cursor = container.querySelector('[data-type-cursor]');
  let timer = null;
  let enabled = false;
  let started = false;
  let lineIndex = 0;
  let characterIndex = 0;

  const placeCursor = (line) => line.after(cursor);
  const schedule = (callback, delay) => {
    timer = window.setTimeout(() => {
      timer = null;
      if (enabled) callback();
    }, delay);
  };
  const typeCharacter = () => {
    const line = lines[lineIndex];
    placeCursor(line);
    characterIndex += 1;
    line.textContent = texts[lineIndex].slice(0, characterIndex).join('');
    if (characterIndex < texts[lineIndex].length) {
      schedule(typeCharacter, 140);
    } else if (lineIndex < lines.length - 1) {
      lineIndex += 1;
      characterIndex = 0;
      schedule(typeCharacter, 260);
    } else {
      container.classList.remove('is-typing');
      schedule(startTyping, 6500);
    }
  };
  const startTyping = () => {
    lineIndex = 0;
    characterIndex = 0;
    lines.forEach((line) => { line.textContent = ''; });
    container.classList.add('is-typing');
    placeCursor(lines[0]);
    typeCharacter();
  };

  return (animate) => {
    if (enabled === animate) return;
    enabled = animate;
    window.clearTimeout(timer);
    timer = null;
    if (enabled) {
      schedule(startTyping, started ? 6500 : 460);
      started = true;
    } else {
      // Pausing always leaves the complete message readable.
      lines.forEach((line, index) => { line.textContent = texts[index].join(''); });
      placeCursor(lines.at(-1));
      container.classList.remove('is-typing');
    }
  };
}
