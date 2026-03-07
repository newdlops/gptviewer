export const buildClickHeaderShareButtonScript = (
  labels: string[],
  testIds: string[] = [],
) => `
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
  const isEnabled = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const ariaDisabled = normalize(element.getAttribute('aria-disabled')) === 'true';
    const dataDisabled = normalize(element.getAttribute('data-disabled')) === 'true';
    const nativeDisabled = 'disabled' in element ? Boolean(element.disabled) : false;
    return !ariaDisabled && !dataDisabled && !nativeDisabled && style.pointerEvents !== 'none';
  };
  const matches = (element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element) || !isEnabled(element)) return false;
    const text = normalize(element.textContent);
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const title = normalize(element.getAttribute('title'));
    const testId = normalize(element.getAttribute('data-testid'));
    if (testIds.has(testId)) return true;
    return labels.some((label) =>
      text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
    );
  };
  const scopes = [
    ...Array.from(document.querySelectorAll('main header, header, [role="banner"], main')),
  ].filter((scope) => scope instanceof HTMLElement && isVisible(scope));
  const scoredTarget = scopes
    .flatMap((scope) =>
      Array.from(scope.querySelectorAll('button, a, [role="button"], [data-testid]'))
        .map((element) => ({ element, scope })),
    )
    .filter(({ element }) => matches(element))
    .map(({ element, scope }) => {
      const elementRect = element.getBoundingClientRect();
      const scopeRect = scope.getBoundingClientRect();
      const topScore = elementRect.top < window.innerHeight * 0.28 ? 20 : 0;
      const headerScore = /header|banner/i.test(scope.tagName) || scope.matches('header, [role="banner"], main header') ? 30 : 0;
      const rightScore = elementRect.left > window.innerWidth * 0.45 ? 10 : 0;
      return { element, score: headerScore + topScore + rightScore - elementRect.top };
    })
    .sort((left, right) => right.score - left.score)[0]?.element;
  if (!(scoredTarget instanceof HTMLElement)) {
    return false;
  }
  scoredTarget.click();
  return true;
})()
`;

export const buildGetHeaderShareButtonPointScript = (
  labels: string[],
  testIds: string[] = [],
) => `
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
  const isEnabled = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const ariaDisabled = normalize(element.getAttribute('aria-disabled')) === 'true';
    const dataDisabled = normalize(element.getAttribute('data-disabled')) === 'true';
    const nativeDisabled = 'disabled' in element ? Boolean(element.disabled) : false;
    return !ariaDisabled && !dataDisabled && !nativeDisabled && style.pointerEvents !== 'none';
  };
  const matches = (element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element) || !isEnabled(element)) return false;
    const text = normalize(element.textContent);
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const title = normalize(element.getAttribute('title'));
    const testId = normalize(element.getAttribute('data-testid'));
    if (testIds.has(testId)) return true;
    return labels.some((label) =>
      text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
    );
  };
  const scopes = [...Array.from(document.querySelectorAll('main header, header, [role="banner"], main'))]
    .filter((scope) => scope instanceof HTMLElement && isVisible(scope));
  const target = scopes
    .flatMap((scope) =>
      Array.from(scope.querySelectorAll('button, a, [role="button"], [data-testid]'))
        .map((element) => ({ element, scope })),
    )
    .filter(({ element }) => matches(element))
    .map(({ element, scope }) => {
      const elementRect = element.getBoundingClientRect();
      const topScore = elementRect.top < window.innerHeight * 0.28 ? 20 : 0;
      const headerScore = /header|banner/i.test(scope.tagName) || scope.matches('header, [role="banner"], main header') ? 30 : 0;
      const rightScore = elementRect.left > window.innerWidth * 0.45 ? 10 : 0;
      return { element, score: headerScore + topScore + rightScore - elementRect.top };
    })
    .sort((left, right) => right.score - left.score)[0]?.element;
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  const rect = target.getBoundingClientRect();
  return {
    x: Math.max(4, Math.round(rect.left + rect.width / 2)),
    y: Math.max(4, Math.round(rect.top + rect.height / 2)),
  };
})()
`;

export const buildActivateHeaderShareButtonScript = (
  labels: string[],
  testIds: string[] = [],
) => `
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
  const isEnabled = (element) => {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    const ariaDisabled = normalize(element.getAttribute('aria-disabled')) === 'true';
    const dataDisabled = normalize(element.getAttribute('data-disabled')) === 'true';
    const nativeDisabled = 'disabled' in element ? Boolean(element.disabled) : false;
    return !ariaDisabled && !dataDisabled && !nativeDisabled && style.pointerEvents !== 'none';
  };
  const matches = (element) => {
    if (!(element instanceof HTMLElement) || !isVisible(element) || !isEnabled(element)) return false;
    const text = normalize(element.textContent);
    const ariaLabel = normalize(element.getAttribute('aria-label'));
    const title = normalize(element.getAttribute('title'));
    const testId = normalize(element.getAttribute('data-testid'));
    if (testIds.has(testId)) return true;
    return labels.some((label) =>
      text === label || text.includes(label) || ariaLabel === label || ariaLabel.includes(label) || title === label || title.includes(label),
    );
  };
  const target = [...Array.from(document.querySelectorAll('main header, header, [role="banner"], main'))]
    .filter((scope) => scope instanceof HTMLElement && isVisible(scope))
    .flatMap((scope) =>
      Array.from(scope.querySelectorAll('button, a, [role="button"], [data-testid]'))
        .map((element) => ({ element, scope })),
    )
    .filter(({ element }) => matches(element))
    .map(({ element, scope }) => {
      const rect = element.getBoundingClientRect();
      const topScore = rect.top < window.innerHeight * 0.28 ? 20 : 0;
      const headerScore = /header|banner/i.test(scope.tagName) || scope.matches('header, [role="banner"], main header') ? 30 : 0;
      const rightScore = rect.left > window.innerWidth * 0.45 ? 10 : 0;
      return { element, score: headerScore + topScore + rightScore - rect.top };
    })
    .sort((left, right) => right.score - left.score)[0]?.element;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  target.scrollIntoView({ block: 'center', inline: 'center' });
  target.focus?.();
  const rect = target.getBoundingClientRect();
  const clientX = rect.left + rect.width / 2;
  const clientY = rect.top + rect.height / 2;
  const pointerInit = { bubbles: true, button: 0, buttons: 1, clientX, clientY };
  target.dispatchEvent(new PointerEvent('pointerenter', pointerInit));
  target.dispatchEvent(new PointerEvent('pointermove', pointerInit));
  target.dispatchEvent(new MouseEvent('mouseenter', pointerInit));
  target.dispatchEvent(new MouseEvent('mouseover', pointerInit));
  target.dispatchEvent(new PointerEvent('pointerdown', pointerInit));
  target.dispatchEvent(new MouseEvent('mousedown', pointerInit));
  target.dispatchEvent(new PointerEvent('pointerup', { ...pointerInit, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('mouseup', { ...pointerInit, buttons: 0 }));
  target.dispatchEvent(new MouseEvent('click', { ...pointerInit, buttons: 0 }));
  target.click?.();
  return true;
})()
`;
