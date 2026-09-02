import classNames from 'classnames'
import { cloneElement, HTMLAttributes, ReactElement, ReactNode, useId } from 'react'
import { InputProps, InputSize } from 'system-ui/input'
import './FormField.css'

interface FormFieldProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  label: ReactNode
  children: ReactElement<InputProps>
  message?: ReactNode
  error?: boolean
  success?: boolean
  required?: boolean
  size?: InputSize
}

const LABEL_TYPOGRAPHY: Record<InputSize, string> = {
  desktop: 'lg-footnote-medium',
  mobile: 'lg-body-regular',
}

const MESSAGE_TYPOGRAPHY: Record<InputSize, string> = {
  desktop: 'lg-caption1-regular',
  mobile: 'lg-footnote-medium',
}

const FormField = ({
  label,
  children,
  message,
  error = false,
  success = false,
  required = false,
  size = 'desktop',
  className,
  ...rest
}: FormFieldProps) => {
  const generatedId = useId()
  const id = children.props.id ?? generatedId
  const messageId = `${id}-message`
  const hasMessage = message !== undefined && message !== null

  const control = cloneElement(children, {
    id,
    size,
    invalid: error,
    success,
    required,
    'aria-describedby': hasMessage ? messageId : undefined,
  })

  return (
    <div {...rest} className={classNames('form-field', className)}>
      <label htmlFor={id} className={classNames('form-field__label', LABEL_TYPOGRAPHY[size])}>
        {label}
        {required && (
          <span aria-hidden className="form-field__required">
            {' *'}
          </span>
        )}
      </label>
      {control}
      {hasMessage && (
        <p
          id={messageId}
          className={classNames('form-field__message', MESSAGE_TYPOGRAPHY[size], {
            'form-field__message--error': error,
            'form-field__message--success': success && !error,
          })}
        >
          {message}
        </p>
      )}
    </div>
  )
}

export { FormField }
export type { FormFieldProps }
