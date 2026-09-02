import classNames from 'classnames'
import { createElement, HTMLAttributes, ReactNode } from 'react'
import './Panel.css'

type PanelHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

interface PanelProps extends HTMLAttributes<HTMLElement> {
  heading: string
  level?: PanelHeadingLevel
  actions?: ReactNode
  children: ReactNode
}

const Panel = ({ heading, level = 2, actions, children, className, ...rest }: PanelProps) => {
  const headingElement = createElement(`h${level}`, { className: 'panel__heading lg-headline-medium' }, heading)

  return (
    <section {...rest} aria-label={heading} className={classNames('panel', className)}>
      <div className="panel__heading-block">
        {headingElement}
        {actions !== undefined && <div className="panel__actions">{actions}</div>}
      </div>
      <div className="panel__body">{children}</div>
    </section>
  )
}

export { Panel }
export type { PanelHeadingLevel, PanelProps }
