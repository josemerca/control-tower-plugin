import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorkflowStep } from 'system-ui/workflow-step'

describe('WorkflowStep', () => {
  it('should expose the active step header as an expanded button that controls its content', () => {
    render(
      <WorkflowStep status="active" title="Preparar el plan">
        El agente prepara el plan
      </WorkflowStep>,
    )

    const header = screen.getByRole('button', { name: /Preparar el plan/ })
    const content = screen.getByRole('region', { name: 'Preparar el plan' })

    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(header).toHaveAttribute('aria-controls', content.id)
    expect(content).not.toHaveAttribute('hidden')
  })

  it('should let a completed step reopen and collapse its content', async () => {
    const user = userEvent.setup()

    render(
      <WorkflowStep status="completed" title="Plan preparado">
        El plan está listo para implementar
      </WorkflowStep>,
    )

    const header = screen.getByRole('button', { name: /Plan preparado/ })
    const content = document.getElementById(header.getAttribute('aria-controls') ?? '')

    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(content).not.toBeNull()
    expect(content).toHaveAttribute('hidden')

    await user.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'true')
    expect(content).not.toHaveAttribute('hidden')

    await user.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(content).toHaveAttribute('hidden')
  })

  it.each(['completed', 'active', 'pending'] as const)('should expose the %s state in its class', (status) => {
    const { container } = render(
      <WorkflowStep status={status} title="Paso">
        Contenido
      </WorkflowStep>,
    )

    expect(container.firstChild).toHaveClass(`workflow-step--${status}`)
  })

  it('should use a caller supplied content identifier', () => {
    render(
      <WorkflowStep status="pending" title="Implementar" contentId="implementation-step">
        Esperando la implementación
      </WorkflowStep>,
    )

    const header = screen.getByRole('button', { name: /Implementar/ })

    expect(header).toHaveAttribute('aria-controls', 'implementation-step')
    expect(document.getElementById('implementation-step')).toHaveAttribute('hidden')
  })
})
