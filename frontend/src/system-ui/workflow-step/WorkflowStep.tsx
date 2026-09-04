import classNames from 'classnames'
import { HTMLAttributes, ReactNode, useId } from 'react'
import './WorkflowStep.css'

type WorkflowStepStatus = 'completed' | 'active' | 'pending'

interface WorkflowStepProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title: ReactNode
  status: WorkflowStepStatus
  children: ReactNode
  isExpanded: boolean
  onExpandedChange: (isExpanded: boolean) => void
  canCollapse?: boolean
  contentId?: string
  isAvailable?: boolean
}

const STATUS_CLASS: Record<WorkflowStepStatus, string> = {
  completed: 'workflow-step--completed',
  active: 'workflow-step--active',
  pending: 'workflow-step--pending',
}

const STATUS_LABEL: Record<WorkflowStepStatus, string> = {
  completed: 'Completado',
  active: 'Activo',
  pending: 'Pendiente',
}

const WorkflowStep = ({
  title,
  status,
  children,
  isExpanded,
  onExpandedChange,
  canCollapse = true,
  contentId,
  isAvailable = status !== 'pending',
  className,
  ...rest
}: WorkflowStepProps) => {
  const generatedId = useId()
  const headerId = `${generatedId}-header`
  const titleId = `${generatedId}-title`
  const resolvedContentId = contentId ?? `${generatedId}-content`
  const isCollapseDisabled = isExpanded && !canCollapse
  return (
    <section {...rest} className={classNames('workflow-step', STATUS_CLASS[status], className)}>
      <button
        id={headerId}
        type="button"
        className="workflow-step__header"
        aria-expanded={isExpanded}
        aria-controls={resolvedContentId}
        aria-disabled={isCollapseDisabled || undefined}
        disabled={!isAvailable}
        onClick={() => {
          if (!isCollapseDisabled) onExpandedChange(!isExpanded)
        }}
      >
        <span className="workflow-step__indicator" aria-hidden="true">
          {status === 'completed' && (
            <svg viewBox="0 0 16 16" className="workflow-step__check" focusable="false">
              <path d="m3.5 8.25 2.75 2.75 6.25-6.25" />
            </svg>
          )}
        </span>
        <span id={titleId} className="workflow-step__title lg-body-medium">
          {title}
        </span>
        <span className="workflow-step__status lg-caption1-regular">{STATUS_LABEL[status]}</span>
        <svg viewBox="0 0 16 16" className="workflow-step__chevron" aria-hidden="true" focusable="false">
          <path d="m3 6 5 5 5-5" />
        </svg>
      </button>
      <div id={resolvedContentId} className="workflow-step__content" role="region" aria-labelledby={titleId} hidden={!isExpanded}>
        {children}
      </div>
    </section>
  )
}

export { WorkflowStep }
export type { WorkflowStepProps, WorkflowStepStatus }
