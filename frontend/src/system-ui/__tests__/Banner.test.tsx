import { render, screen } from '@testing-library/react'
import { Banner } from 'system-ui/banner'

describe('Banner', () => {
  it('should be a polite live region when it carries a tone', () => {
    render(<Banner type="success" title="Guardado" />)

    expect(screen.getByRole('status')).toHaveTextContent('Correcto: Guardado')
  })

  it('should not be a live region when it is neutral', () => {
    render(<Banner title="Sin tono" />)

    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('Sin tono')).toBeInTheDocument()
  })

  it('should let the caller turn an error into an interrupting alert', () => {
    render(<Banner type="error" role="alert" title="Falló" />)

    expect(screen.getByRole('alert')).toHaveTextContent('Error: Falló')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('should paint the icon of its type and hide it from the accessibility tree', () => {
    const { container } = render(<Banner type="warning" title="Cuidado" />)

    const icon = container.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon).toHaveAttribute('aria-hidden', 'true')
    expect(container.firstChild).toHaveClass('banner--warning')
  })
})
