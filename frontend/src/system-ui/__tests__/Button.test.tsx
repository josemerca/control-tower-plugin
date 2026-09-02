import { render, screen } from '@testing-library/react'
import { Button } from 'system-ui/button'

describe('Button', () => {
  it('should default to a plain button so a form is not submitted by accident', () => {
    render(<Button>Guardar</Button>)

    expect(screen.getByRole('button', { name: 'Guardar' })).toHaveAttribute('type', 'button')
  })

  it('should wear the class of its variant and its size', () => {
    render(
      <Button variant="danger" size="mobile">
        Borrar
      </Button>,
    )

    const button = screen.getByRole('button', { name: 'Borrar' })
    expect(button).toHaveClass('button--danger')
    expect(button).toHaveClass('button--mobile')
  })

  it('should keep the label in the footnote type style the system prescribes', () => {
    render(<Button>Guardar</Button>)

    expect(screen.getByText('Guardar')).toHaveClass('lg-footnote-medium')
  })
})
