import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 18, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    ...props,
  }
}

export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>
)
export const MoreIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></svg>
)
export const SendIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M5 12h13M13 6l6 6-6 6" /></svg>
)
export const StopIcon = (p: IconProps) => (
  <svg {...base(p)}><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>
)
export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>
)
export const ChevronLeft = (p: IconProps) => (
  <svg {...base(p)}><path d="M15 6l-6 6 6 6" /></svg>
)
export const ChevronRight = (p: IconProps) => (
  <svg {...base(p)}><path d="M9 6l6 6-6 6" /></svg>
)
export const FileIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>
)
export const UploadIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 15V4M7 9l5-5 5 5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></svg>
)
export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
)
export const MoonIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
)
export const TrashIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
)
export const RetryIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4" /></svg>
)
export const AlertIcon = (p: IconProps) => (
  <svg {...base(p)}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></svg>
)
