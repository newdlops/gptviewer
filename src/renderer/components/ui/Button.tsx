import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'ghost' | 'secondary' | 'primary' | 'danger';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
};

const getButtonClassName = (
  variant: ButtonVariant,
  className?: string,
): string => {
  const classes = ['button', `button--${variant}`];

  if (className) {
    classes.push(className);
  }

  return classes.join(' ');
};

const getTooltipText = (
  title: ButtonHTMLAttributes<HTMLButtonElement>['title'],
  ariaLabel: ButtonHTMLAttributes<HTMLButtonElement>['aria-label'],
  children: ReactNode,
): string | undefined => {
  if (typeof title === 'string' && title.trim()) {
    return title.trim();
  }

  if (typeof ariaLabel === 'string' && ariaLabel.trim()) {
    return ariaLabel.trim();
  }

  if (typeof children === 'string' && children.trim()) {
    return children.trim();
  }

  return undefined;
};

export function Button({
  'aria-label': ariaLabel,
  children,
  className,
  title,
  type = 'button',
  variant = 'secondary',
  ...props
}: ButtonProps) {
  const tooltipText = getTooltipText(title, ariaLabel, children);

  return (
    <button
      type={type}
      className={getButtonClassName(variant, className)}
      aria-label={ariaLabel}
      data-tooltip={tooltipText}
      {...props}
    >
      {children}
    </button>
  );
}
