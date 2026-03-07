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

export function Button({
  children,
  className,
  type = 'button',
  variant = 'secondary',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={getButtonClassName(variant, className)}
      {...props}
    >
      {children}
    </button>
  );
}
