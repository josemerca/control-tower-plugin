import { render, screen } from '@testing-library/react'
import { FormField } from 'system-ui/form-field'
import { Input } from 'system-ui/input'

describe('FormField', () => {
  it('should wire the label to the control so the label text finds the input', () => {
    render(
      <FormField label="Nombre de la ruta">
        <Input />
      </FormField>,
    )

    expect(screen.getByLabelText('Nombre de la ruta')).toBeInstanceOf(HTMLInputElement)
  })

  it('should expose the message through aria-describedby', () => {
    render(
      <FormField label="Código" message="Tres letras">
        <Input />
      </FormField>,
    )

    const input = screen.getByLabelText('Código')
    const described = input.getAttribute('aria-describedby')
    expect(described).not.toBeNull()
    expect(document.getElementById(described as string)).toHaveTextContent('Tres letras')
  })

  it('should mark the control invalid when the field is in error', () => {
    render(
      <FormField label="Código" message="No vale" error>
        <Input />
      </FormField>,
    )

    expect(screen.getByLabelText('Código')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('No vale')).toHaveClass('form-field__message--error')
  })
})
