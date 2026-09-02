import classNames from 'classnames'
import { ComponentType, HTMLAttributes, ReactNode } from 'react'
import { StatusIconProps, StatusInfoIcon, StatusKoIcon, StatusSuccessIcon, StatusWarningIcon } from 'system-ui/icons/StatusIcons'
import './Banner.css'

const GLYPH_SIZE = 16

type BannerType = 'default' | 'informative' | 'success' | 'warning' | 'error'
type BannerDescriptionLayout = 'inline' | 'multiline'
type BannerIcon = ComponentType<StatusIconProps>

interface BannerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title: ReactNode
  type?: BannerType
  description?: ReactNode
  descriptionLayout?: BannerDescriptionLayout
  icon?: BannerIcon
}

const TYPE_ICON: Record<BannerType, BannerIcon | null> = {
  default: null,
  informative: StatusInfoIcon,
  success: StatusSuccessIcon,
  warning: StatusWarningIcon,
  error: StatusKoIcon,
}

const TYPE_CLASS: Record<BannerType, string> = {
  default: 'banner--default',
  informative: 'banner--informative',
  success: 'banner--success',
  warning: 'banner--warning',
  error: 'banner--error',
}

const TYPE_LABEL: Record<BannerType, string | null> = {
  default: null,
  informative: 'Información',
  success: 'Correcto',
  warning: 'Aviso',
  error: 'Error',
}

const Banner = ({ title, type = 'default', description, descriptionLayout = 'multiline', icon, className, ...rest }: BannerProps) => {
  const Glyph = icon ?? TYPE_ICON[type]
  const typeLabel = TYPE_LABEL[type]
  const hasDescription = description !== undefined && description !== null
  const isMultiline = hasDescription && descriptionLayout === 'multiline'

  return (
    <div
      role={type === 'default' ? undefined : 'status'}
      {...rest}
      className={classNames('banner', TYPE_CLASS[type], { 'banner--multiline': isMultiline }, className)}
    >
      <div className="banner__content">
        {Glyph !== null && <Glyph size={GLYPH_SIZE} className="banner__icon" aria-hidden="true" />}
        <div className={classNames('banner__text', { 'banner__text--inline': hasDescription && !isMultiline })}>
          <span className="banner__title lg-body-medium">
            {typeLabel !== null && <span className="banner__visually-hidden">{`${typeLabel}: `}</span>}
            {title}
          </span>
          {hasDescription && ' '}
          {hasDescription && <span className="banner__description lg-footnote-medium">{description}</span>}
        </div>
      </div>
    </div>
  )
}

export { Banner }
export type { BannerDescriptionLayout, BannerProps, BannerType }
