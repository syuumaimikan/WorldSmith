import { ReactNode } from 'react';
import { ItemId } from '../../data/items';
import { itemName } from '../../i18n/names';

export { ItemIcon } from './ItemIcon';

export function Window({
  title,
  onClose,
  children,
  width,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: 'narrow' | 'normal' | 'wide';
  footer?: ReactNode;
}): JSX.Element {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`window ${width === 'narrow' ? 'narrow' : width === 'wide' ? 'wide' : ''}`}>
        <div className="window-head">
          <h3>{title}</h3>
          <button className="close-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="window-body">{children}</div>
        {footer}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  active: T;
  onChange: (id: T) => void;
}): JSX.Element {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`tab ${active === t.id ? 'active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Bar({ value, color }: { value: number; color?: string }): JSX.Element {
  return (
    <div className="bar">
      <div style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: color }} />
    </div>
  );
}

export function Pill({ tone, children }: { tone?: 'good' | 'warn' | 'bad'; children: ReactNode }): JSX.Element {
  return <span className={`pill ${tone ?? ''}`}>{children}</span>;
}

export function EmptyNote({ children }: { children: ReactNode }): JSX.Element {
  return <div className="empty-note">{children}</div>;
}

export function itemLabel(item: ItemId): string {
  return itemName(item);
}
