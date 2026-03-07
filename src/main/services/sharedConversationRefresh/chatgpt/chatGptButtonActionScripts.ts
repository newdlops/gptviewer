import { ACTIONABLE_SELECTOR, type HoverPoint } from './chatGptAutomationScripts';

export const buildGetButtonPointScript = (labels: string[], testIds: string[] = []) => `
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
  const target = Array.from(document.querySelectorAll(${JSON.stringify(ACTIONABLE_SELECTOR)})).find((element) => {
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
  if (!(target instanceof HTMLElement)) return null;
  target.scrollIntoView({ block: 'center', inline: 'center' });
  const rect = target.getBoundingClientRect();
  return { x: Math.max(4, Math.round(rect.left + rect.width / 2)), y: Math.max(4, Math.round(rect.top + rect.height / 2)) };
})()
`;

export type { HoverPoint };

