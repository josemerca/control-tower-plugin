import classNames from 'classnames'
import { InputHTMLAttributes } from 'react'
import './Input.css'

type InputSize = 'desktop' | 'mobile'
type InputType = 'text' | 'number' | 'password' | 'search'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> {
  size?: InputSize
  type?: InputType
  invalid?: boolean
  success?: boolean
}

const SIZE_CLASS: Record<InputSize, string> = {
  desktop: 'input-shell--desktop',
  mobile: 'input-shell--mobile',
}

const Input = ({ size = 'desktop', type = 'text', invalid = false, success = false, className, disabled, ...rest }: InputProps) => {
  return (
    <div
      className={classNames('input-shell', SIZE_CLASS[size], {
        'input-shell--error': invalid,
        'input-shell--success': success && !invalid,
        'input-shell--disabled': disabled,
      }, className)}
    >
      <input {...rest} type={type} disabled={disabled} aria-invalid={invalid || undefined} className="input-shell__control lg-body-regular" />
    </div>
  )
}

export { Input }
export type { InputProps, InputSize, InputType }
