import type { JSX, ReactNode } from 'react';

/** Semantic 24px icons for every widget shown in the component palette. */
const ICONS: Record<string, ReactNode> = {
  obj: <><rect x="3" y="4" width="18" height="16" rx="2.5" strokeDasharray="2.5 2.5" /><path className="wi-accent" d="M3 9h18" /></>,
  label: <><path d="M5 5h14M12 5v14M8.5 19h7" /><path className="wi-accent" d="M9 9h6" /></>,
  button: <><rect className="wi-soft" x="3" y="6" width="18" height="12" rx="4" /><path className="wi-accent" d="M8 12h8" /></>,
  spangroup: <><path className="wi-accent" d="M4 7h6" /><path d="M12 7h8M4 12h9M15 12h5M4 17h5M11 17h9" /></>,
  line: <><path className="wi-muted" d="M3 19h18" /><path className="wi-accent" d="m3 16 5-6 5 3 8-8" /><circle cx="8" cy="10" r="1.2" /><circle cx="13" cy="13" r="1.2" /></>,
  arclabel: <><path className="wi-accent" d="M5 17a8 8 0 0 1 14 0" /><path d="m7.5 12 1 1.5M12 10.5v2M16.5 12l-1 1.5" /></>,
  slider: <><path className="wi-muted" d="M3 12h18" /><path className="wi-accent" d="M3 12h11" /><circle className="wi-surface" cx="14" cy="12" r="3.2" /></>,
  switch: <><rect className="wi-accent-fill" x="3" y="7" width="18" height="10" rx="5" /><circle className="wi-knob" cx="16" cy="12" r="3.5" /></>,
  checkbox: <><rect className="wi-accent-fill" x="3.5" y="5" width="7" height="7" rx="1.5" /><path className="wi-knob-stroke" d="m5.5 8.5 1.5 1.5 2-3" /><path d="M13.5 7h7M13.5 11h5.5M4 17h16" /></>,
  arc: <><path className="wi-muted" d="M5 17a8 8 0 1 1 14 0" /><path className="wi-accent" d="M5 17a8 8 0 0 1 8-12" /><circle className="wi-accent-fill" cx="5" cy="17" r="1.2" /></>,
  dropdown: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M7 10h6" /><path className="wi-accent" d="m15.5 10 2 2 2-2" /></>,
  roller: <><rect x="6" y="3" width="12" height="18" rx="3" /><path className="wi-muted" d="M9 7h6M9 17h6" /><path className="wi-accent" d="M8 12h8" /></>,
  textarea: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 9h7M7 13h10M7 17h5" /><path className="wi-accent" d="M16 7v4" /></>,
  spinbox: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M8 6v12M16 6v12M4.5 12H6M18 12h2M19 11v2" /><path className="wi-accent" d="M11 12h2" /></>,
  buttonmatrix: <><rect x="3" y="5" width="5" height="5" rx="1" /><rect className="wi-accent-fill" x="9.5" y="5" width="5" height="5" rx="1" /><rect x="16" y="5" width="5" height="5" rx="1" /><rect x="3" y="12" width="5" height="5" rx="1" /><rect x="9.5" y="12" width="5" height="5" rx="1" /><rect x="16" y="12" width="5" height="5" rx="1" /></>,
  keyboard: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><path d="M6 9h.01M9 9h.01M12 9h.01M15 9h.01M18 9h.01M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01" /><path className="wi-accent" d="M8 15.5h8" /></>,
  imagebutton: <><rect className="wi-soft" x="3" y="4" width="18" height="16" rx="4" /><circle cx="16" cy="9" r="1.5" /><path className="wi-accent" d="m6 17 4.5-5 3 3 2-2 3 4" /></>,
  bar: <><rect className="wi-muted-fill" x="3" y="8" width="18" height="8" rx="4" /><path className="wi-accent-fill" d="M7 8h6a4 4 0 0 1 0 8H7a4 4 0 0 1 0-8Z" /></>,
  led: <><circle className="wi-accent-fill" cx="12" cy="12" r="4" /><path className="wi-muted" d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
  qrcode: <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path className="wi-solid" d="M15 14h2v2h-2zM18 14h2v4h-2zM14 18h4v2h-4z" /></>,
  scale: <><path d="M3 16h18M4 9v7M8 12v4M12 9v7M16 12v4M20 9v7" /><path className="wi-accent" d="M12 6v3" /></>,
  spinner: <><circle className="wi-muted" cx="12" cy="12" r="8" /><path className="wi-accent wi-spin" d="M12 4a8 8 0 0 1 7.4 5" /></>,
  calendar: <><rect x="3" y="4.5" width="18" height="16" rx="2.5" /><path className="wi-accent" d="M3 9h18M8 3v3M16 3v3" /><path d="M7 13h.01M12 13h.01M17 13h.01M7 17h.01M12 17h.01M17 17h.01" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><path className="wi-accent" d="M3 9h18" /><path d="M3 14h18M9 4v16M15 4v16" /></>,
  list: <><circle className="wi-accent-fill" cx="5" cy="7" r="1" /><circle cx="5" cy="12" r="1" /><circle cx="5" cy="17" r="1" /><path d="M9 7h11M9 12h8M9 17h10" /></>,
  menu: <><rect x="3" y="4" width="18" height="16" rx="2" /><path className="wi-soft" d="M3 4h6v16H3z" /><path d="M5 8h2M5 12h2M5 16h2M12 8h6M12 12h5M12 16h4" /><path className="wi-accent" d="M11 12h7" /></>,
  msgbox: <><rect className="wi-soft" x="3" y="5" width="18" height="14" rx="3" /><path d="M7 9h7M7 12h10" /><path className="wi-accent" d="M12 16h5" /></>,
  win: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path className="wi-soft" d="M3 9h18" /><circle cx="6" cy="6.5" r=".7" /><circle cx="8.5" cy="6.5" r=".7" /></>,
  tabview: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9h18M9 4v5M15 4v5" /><path className="wi-accent" d="M4 9h5" /></>,
  tileview: <><rect className="wi-accent-fill" x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="8" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /><rect x="13" y="13" width="8" height="8" rx="2" /></>,
  chart: <><path d="M4 4v16h17" /><path className="wi-muted" d="M8 17v-4M12 17V9M16 17v-7M20 17V6" /><path className="wi-accent" d="m6 12 5-4 4 2 5-5" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><circle className="wi-accent-fill" cx="16.5" cy="8.5" r="1.5" /><path d="m5.5 17 5-6 3.5 4 2-2 2.5 4" /></>,
  animimage: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="m5.5 17 4.5-5 3 3 2-2 3 4" /><circle className="wi-accent-fill" cx="17.5" cy="16.5" r="3.5" /><path className="wi-knob-fill" d="m16.6 14.8 2.4 1.7-2.4 1.7Z" /></>,
  canvas: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path className="wi-accent" d="M6 15c2-6 5 3 8-4 1.2-2.8 2.3-3 4-3" /><circle className="wi-accent-fill" cx="6" cy="15" r="1" /></>,
  lottie: <><path className="wi-accent" d="M12 3.5 14.2 9l5.8.4-4.5 3.7 1.4 5.7-4.9-3.1-4.9 3.1 1.4-5.7L4 9.4 9.8 9Z" /><path d="M4 5h3M17 20h3" /></>,
};

export const WIDGET_ICON_TYPES = new Set(Object.keys(ICONS));

const FALLBACK_ICON = <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="M8 9h8M8 13h5M8 17h7" /></>;

export function WidgetThumb({ type }: { type: string }): JSX.Element {
  return (
    <svg className={`wthumb wthumb-${type}`} viewBox="0 0 24 24" aria-hidden="true">
      {ICONS[type] ?? FALLBACK_ICON}
    </svg>
  );
}
