export const ACTIONABLE_SELECTOR =
  'button, a, [role="button"], [role="menuitem"], [role="option"], [data-testid]';

export type ChatGptPageSnapshot = {
  actionLabels: string[];
  bodyText: string;
  currentUrl: string;
  title: string;
};

export type SharedUrlCandidateSnapshot = {
  currentUrl: string;
  matchedTextUrl: string | null;
  urls: string[];
};

export type HoverPoint = {
  x: number;
  y: number;
};

export const buildFindAndClickScript = (labels: string[], testIds: string[] = []) => `
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const labels = ${JSON.stringify(labels)}.map((value) => normalize(value));
  const testIds = new Set(${JSON.stringify(testIds)});
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden');
  };
  const isEnabled = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(element);
    const ariaDisabled = normalize(element.getAttribute('aria-disabled')) === 'true';
    const dataDisabled = normalize(element.getAttribute('data-disabled')) === 'true';
    const nativeDisabled = 'disabled' in element ? Boolean(element.disabled) : false;
    return !ariaDisabled && !dataDisabled && !nativeDisabled && style.pointerEvents !== 'none';
  };
  const candidates = Array.from(document.querySelectorAll(${JSON.stringify(ACTIONABLE_SELECTOR)}));
  const target = candidates.find((element) => {
    if (!isVisible(element) || !isEnabled(element)) return false;
    const text = normalize(element.textContent);
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const title = normalize(element.getAttribute('title'));
    const testId = normalize(element.getAttribute('data-testid'));
    if (testIds.has(testId)) return true;
    return labels.some((label) =>
      text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
    );
  });
  if (!target) return false;
  target.click();
  return true;
})()
`;

export const buildHasButtonScript = (labels: string[], testIds: string[] = []) => `
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const labels = ${JSON.stringify(labels)}.map((value) => normalize(value));
  const testIds = new Set(${JSON.stringify(testIds)});
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden');
  };
  return Array.from(document.querySelectorAll(${JSON.stringify(ACTIONABLE_SELECTOR)})).some((element) => {
    if (!isVisible(element)) return false;
    const text = normalize(element.textContent);
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const title = normalize(element.getAttribute('title'));
    const testId = normalize(element.getAttribute('data-testid'));
    if (testIds.has(testId)) return true;
    return labels.some((label) =>
      text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
    );
  });
})()
`;

export const buildHasVisibleDialogScript = () => `
(() => {
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
  };
  return Array.from(document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-radix-popper-content-wrapper]'))
    .some((element) => isVisible(element));
})()
`;

export const buildHasTextMarkersScript = (markers: string[]) => `
(() => {
  const bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const markers = ${JSON.stringify(markers)}.map((value) => value.toLowerCase());
  return markers.some((marker) => bodyText.includes(marker));
})()
`;

export const buildClickActionAboveScript = (labels: string[], testIds: string[] = []) => `
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const labels = ${JSON.stringify(labels)}.map((value) => normalize(value));
  const testIds = new Set(${JSON.stringify(testIds)});
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
  };
  const candidates = Array.from(document.querySelectorAll(${JSON.stringify(ACTIONABLE_SELECTOR)}));
  const target = candidates.find((element) => {
    if (!isVisible(element)) return false;
    const text = normalize(element.textContent);
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const title = normalize(element.getAttribute('title'));
    const testId = normalize(element.getAttribute('data-testid'));
    if (testIds.has(testId)) return true;
    return labels.some((label) =>
      text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
    );
  });
  if (!(target instanceof HTMLElement)) return false;
  const modalRoot = target.closest('[role="dialog"]') || target.closest('[aria-modal="true"]') || target.closest('[data-radix-popper-content-wrapper]') || target.parentElement;
  const scope = modalRoot || document;
  const targetRect = target.getBoundingClientRect();
  const actionables = Array.from(scope.querySelectorAll(${JSON.stringify(ACTIONABLE_SELECTOR)}))
    .filter((element) => element instanceof HTMLElement && element !== target && isVisible(element));
  const scored = actionables
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const verticalGap = targetRect.top - rect.bottom;
      const horizontalOverlap = Math.max(0, Math.min(targetRect.right, rect.right) - Math.max(targetRect.left, rect.left));
      return { element, horizontalOverlap, rect, verticalGap };
    })
    .filter((entry) => entry.verticalGap >= -8 && entry.rect.top < targetRect.top)
    .sort((left, right) => {
      if (right.horizontalOverlap !== left.horizontalOverlap) return right.horizontalOverlap - left.horizontalOverlap;
      return left.verticalGap - right.verticalGap;
    });
  const nearestAbove = scored[0]?.element;
  if (!(nearestAbove instanceof HTMLElement)) return false;
  nearestAbove.click();
  return true;
})()
`;

export const buildClickLinkByUrlScript = (targetUrl: string) => `
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const toUrl = (value) => {
    try {
      return new URL(value, window.location.origin);
    } catch {
      return null;
    }
  };
  const target = toUrl(${JSON.stringify(targetUrl)});
  if (!target) return false;
  const normalizedTargetHref = normalize(target.toString().replace(/\\/$/, ''));
  const normalizedTargetPath = normalize(target.pathname.replace(/\\/$/, ''));
  const normalizedTargetPathWithSearch = normalize((target.pathname + target.search).replace(/\\/$/, ''));
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
  };
  const getScore = (href) => {
    const parsed = toUrl(href);
    if (!parsed) return 0;
    const normalizedHref = normalize(parsed.toString().replace(/\\/$/, ''));
    const normalizedPath = normalize(parsed.pathname.replace(/\\/$/, ''));
    const normalizedPathWithSearch = normalize((parsed.pathname + parsed.search).replace(/\\/$/, ''));
    if (normalizedHref === normalizedTargetHref) return 5;
    if (normalizedTargetPathWithSearch && normalizedTargetPathWithSearch !== '/' && normalizedPathWithSearch === normalizedTargetPathWithSearch) return 4;
    if (normalizedTargetPath && normalizedTargetPath !== '/' && normalizedPath === normalizedTargetPath) return 3;
    if (normalizedTargetPathWithSearch && normalizedTargetPathWithSearch !== '/' && normalizedHref.includes(normalizedTargetPathWithSearch)) return 2;
    if (normalizedTargetPath && normalizedTargetPath !== '/' && normalizedHref.includes(normalizedTargetPath)) return 1;
    return 0;
  };
  const targetLink = Array.from(document.querySelectorAll('a[href]'))
    .filter((element) => element instanceof HTMLAnchorElement && isVisible(element))
    .map((link) => ({ link, score: getScore(link.href) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.link;
  if (!(targetLink instanceof HTMLElement)) return false;
  targetLink.scrollIntoView({ block: 'center' });
  targetLink.click();
  return true;
})()
`;

export const buildFindAndClickFloatingScript = (labels: string[], testIds: string[] = []) => `
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const labels = ${JSON.stringify(labels)}.map((value) => normalize(value));
  const testIds = new Set(${JSON.stringify(testIds)});
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
  };
  const isEnabled = (element) => {
    if (!(element instanceof HTMLElement)) return true;
    const style = window.getComputedStyle(element);
    const ariaDisabled = normalize(element.getAttribute('aria-disabled')) === 'true';
    const dataDisabled = normalize(element.getAttribute('data-disabled')) === 'true';
    const nativeDisabled = 'disabled' in element ? Boolean(element.disabled) : false;
    return !ariaDisabled && !dataDisabled && !nativeDisabled && style.pointerEvents !== 'none';
  };
  const scopeSelectors = [
    '[role="menu"]',
    '[role="dialog"]',
    '[aria-modal="true"]',
    '[data-radix-popper-content-wrapper]',
    '[data-state="open"]',
    '[data-side]',
  ];
  const scopes = Array.from(document.querySelectorAll(scopeSelectors.join(',')))
    .filter((scope) => scope instanceof HTMLElement && isVisible(scope));
  const candidates = scopes
    .flatMap((scope) => Array.from(scope.querySelectorAll(${JSON.stringify(ACTIONABLE_SELECTOR)})))
    .filter((element, index, items) => items.indexOf(element) === index);
  const target = candidates.find((element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element) || !isEnabled(element)) return false;
    const text = normalize(element.textContent);
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const title = normalize(element.getAttribute('title'));
    const testId = normalize(element.getAttribute('data-testid'));
    if (testIds.has(testId)) return true;
    return labels.some((label) =>
      text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
    );
  });
  if (!(target instanceof HTMLElement)) return false;
  target.click();
  return true;
})()
`;

export const buildHasFloatingButtonScript = (labels: string[], testIds: string[] = []) => `
(() => {
  const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
  const labels = ${JSON.stringify(labels)}.map((value) => normalize(value));
  const testIds = new Set(${JSON.stringify(testIds)});
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
  };
  const scopes = Array.from(document.querySelectorAll('[role="menu"], [data-radix-popper-content-wrapper], [data-state="open"], [data-side]'))
    .filter((scope) => scope instanceof HTMLElement && isVisible(scope));
  return scopes.some((scope) =>
    Array.from(scope.querySelectorAll(${JSON.stringify(ACTIONABLE_SELECTOR)})).some((element) => {
      if (!(element instanceof HTMLElement) || !isVisible(element)) return false;
      const text = normalize(element.textContent);
      const ariaLabel = normalize(element.getAttribute('aria-label'));
      const title = normalize(element.getAttribute('title'));
      const testId = normalize(element.getAttribute('data-testid'));
      if (testIds.has(testId)) return true;
      return labels.some((label) =>
        text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
      );
    }),
  );
})()
`;

export const buildGetHoverPointForSelectorsScript = (selectors: string[]) => `
(() => {
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && !element.hasAttribute('hidden') && rect.width > 0 && rect.height > 0;
  };
  for (const selector of ${JSON.stringify(selectors)}) {
    const target = document.querySelector(selector);
    if (target instanceof HTMLElement && isVisible(target)) {
      const rect = target.getBoundingClientRect();
      return {
        x: Math.max(4, Math.round(rect.left + Math.min(rect.width * 0.25, Math.max(rect.width - 24, 24)))),
        y: Math.max(4, Math.round(rect.top + Math.min(rect.height * 0.2, Math.max(rect.height - 16, 16)))),
      };
    }
  }
  return null;
})()
`;

export const buildSendMessageScript = (message: string) => `
(async () => {
  console.log('[gptviewer-script] buildSendMessageScript started');
  const textarea = document.getElementById('prompt-textarea');
  if (!textarea) {
    console.error('[gptviewer-script] Textarea not found');
    return { success: false, error: 'Textarea not found' };
  }

  console.log('[gptviewer-script] Setting textarea value');
  textarea.value = ${JSON.stringify(message)};
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
  
  // React often needs a tick to enable the button based on textarea input
  await new Promise(resolve => setTimeout(resolve, 300));

  console.log('[gptviewer-script] Searching for send button');
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && rect.width > 0 && rect.height > 0;
  };

  // 1. Try explicit data-testid
  const sendButton = document.querySelector('button[data-testid="send-button"]');
  if (sendButton && isVisible(sendButton) && !sendButton.disabled) {
      console.log('[gptviewer-script] Clicking primary send button');
      sendButton.click();
      return { success: true };
  }

  // 2. Try aria-label
  const ariaSendButton = document.querySelector('button[aria-label*="Send"]');
  if (ariaSendButton && isVisible(ariaSendButton) && !ariaSendButton.disabled) {
      console.log('[gptviewer-script] Clicking aria-label send button');
      ariaSendButton.click();
      return { success: true };
  }

  // 3. Try hitting Enter in textarea
  console.log('[gptviewer-script] Buttons not found/disabled, trying Enter keydown');
  textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter' }));
  
  // Wait a bit to see if form resets
  await new Promise(resolve => setTimeout(resolve, 500));
  if (textarea.value === '') {
      console.log('[gptviewer-script] Enter keydown succeeded (textarea cleared)');
      return { success: true };
  }

  console.error('[gptviewer-script] Failed to send message through any DOM method');
  return { success: false, error: 'Send button disabled or not found, Enter key failed' };
})()
`;

export const buildIsRespondingScript = () => `
(() => {
  const isVisible = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           !element.hasAttribute('hidden') && 
           rect.width > 0 && 
           rect.height > 0;
  };

  // 1. Primary check: The Stop generating button usually has a clear aria-label or testid
  const stopButtons = Array.from(document.querySelectorAll('button[data-testid="stop-button"], button[aria-label*="Stop generating"], button[aria-label*="Stop"]'));
  if (stopButtons.some(b => isVisible(b))) return true;
  
  // 2. Fallback check: only check buttons that don't have aria labels (to avoid false positives on media player stops etc)
  const buttons = Array.from(document.querySelectorAll('button'));
  return buttons.some(b => {
    if (!isVisible(b) || b.disabled) return false;
    
    // If it has an aria label but wasn't caught above, it's not our stop button
    if (b.hasAttribute('aria-label')) return false;
    
    // The stop button typically has a square rect inside its SVG
    const svg = b.querySelector('svg');
    if (svg) {
       const rect = svg.querySelector('rect');
       if (rect) {
           const width = parseInt(rect.getAttribute('width'));
           const height = parseInt(rect.getAttribute('height'));
           if (width === height && width > 5 && width < 24) {
               return true;
           }
       }
    }
    return false;
  });
})()
`;
