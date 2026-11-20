const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

const make = (paths) =>
  function Icon({ size = 18, ...props }) {
    return (
      <svg {...base} width={size} height={size} {...props}>
        {paths}
      </svg>
    );
  };

export const TrophyIcon = make(
  <>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z" />
    <path d="M17 6h3v2a3 3 0 0 1-3 3M7 6H4v2a3 3 0 0 0 3 3" />
  </>,
);
export const ArrowUpIcon = make(<path d="M12 19V5M5 12l7-7 7 7" />);
export const ArrowDownIcon = make(<path d="M12 5v14M19 12l-7 7-7-7" />);
export const SearchIcon = make(
  <>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </>,
);
export const FlameIcon = make(
  <path d="M12 22c4 0 7-3 7-7 0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-2 2-5 5-5 8 0 4 3 7 7 7Z" />,
);
export const UsersIcon = make(
  <>
    <circle cx="9" cy="8" r="4" />
    <path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-4-6.3" />
  </>,
);
export const CalendarIcon = make(
  <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
  </>,
);
export const PlusIcon = make(<path d="M12 5v14M5 12h14" />);
export const EditIcon = make(<path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" />);
export const CloseIcon = make(<path d="M18 6 6 18M6 6l12 12" />);
export const MenuIcon = make(<path d="M4 6h16M4 12h16M4 18h16" />);
export const LogoutIcon = make(<path d="M15 4h4v16h-4M10 17l5-5-5-5M15 12H3" />);
export const HistoryIcon = make(
  <>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
    <path d="M3 3v5h5M12 7v5l3 2" />
  </>,
);
export const ChartIcon = make(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />);
export const SettingsIcon = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
  </>,
);
export const ShieldIcon = make(<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />);
export const CameraIcon = make(
  <>
    <path d="M4 7h3l2-3h6l2 3h3v13H4V7Z" />
    <circle cx="12" cy="13" r="4" />
  </>,
);
export const ChevronLeftIcon = make(<path d="m15 18-6-6 6-6" />);
export const ChevronRightIcon = make(<path d="m9 18 6-6-6-6" />);
export const RefreshIcon = make(<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6" />);
export const MapPinIcon = make(
  <>
    <path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" />
    <circle cx="12" cy="10" r="2.5" />
  </>,
);

/** Pickleball logo mark. */
export function BallLogo({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="29" fill="var(--ball)" stroke="var(--court-900)" strokeWidth="4" />
      <g fill="var(--court-900)">
        <circle cx="22" cy="20" r="4" />
        <circle cx="38" cy="16" r="4" />
        <circle cx="46" cy="30" r="4" />
        <circle cx="30" cy="32" r="4" />
        <circle cx="18" cy="38" r="4" />
        <circle cx="34" cy="46" r="4" />
        <circle cx="48" cy="45" r="3.5" />
      </g>
    </svg>
  );
}
