import classNames from 'classnames'
import { ButtonHTMLAttributes, ReactNode } from 'react'
import './Button.css'

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'link' | 'danger' | 'danger-ghost'
type ButtonSize = 'desktop' | 'mobile'

interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  type?: 'button' | 'submit' | 'reset'
  fullWidth?: boolean
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'button--primary',
  secondary: 'button--secondary',
  tertiary: 'button--tertiary',
  link: 'button--link',
  danger: 'button--danger',
  'danger-ghost': 'button--danger-ghost',
}

const SIZE_CLASS: Record<ButtonSize, string> = {
  desktop: 'button--desktop',
  mobile: 'button--mobile',
}

const Button = ({
  children,
  variant = 'primary',
  size = 'desktop',
  type = 'button',
  fullWidth = false,
  className,
  ...rest
}: ButtonProps) => {
  return (
    <button
      {...rest}
      type={type}
      className={classNames('button', VARIANT_CLASS[variant], SIZE_CLASS[size], { 'button--full-width': fullWidth }, className)}
    >
      <span className="button__state-layer">
        <span className="button__label lg-footnote-medium">{children}</span>
      </span>
    </button>
  )
}

export { Button }
export type { ButtonProps, ButtonSize, ButtonVariant }
