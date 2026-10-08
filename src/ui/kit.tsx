// Wiederverwendbare UI-Bausteine im iOS-Stil.

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, CloudOff, Wifi, X, AlertTriangle, RefreshCw } from 'lucide-react';
import { useApp } from '../state/appStore';
import { back } from '../router';

export function Nav(props: { title?: string; backLabel?: string; onBack?: () => void; right?: ReactNode; left?: ReactNode; large?: boolean }) {
  return (
    <header className={`nav${props.large ? ' large' : ''}`}>
      <div className="nav-left">
        {props.left ?? (props.backLabel !== undefined || props.onBack ? (
          <button className="nav-btn" onClick={props.onBack ?? (() => back())} aria-label="Zurück">
            <ChevronLeft size={26} strokeWidth={2.4} />
            <span className="ellipsis" style={{ maxWidth: '26vw' }}>{props.backLabel ?? 'Zurück'}</span>
          </button>
        ) : null)}
      </div>
      <div className="nav-title">{props.title}</div>
      <div className="nav-right">{props.right}</div>
    </header>
  );
}

export function Sheet(props: { open: boolean; onClose: () => void; title?: string; children: ReactNode; full?: boolean; left?: ReactNode; right?: ReactNode }) {
  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.open, props.onClose]);
  if (!props.open) return null;
  return createPortal(
    <>
      <div className="backdrop" onClick={props.onClose} />
      <div className={`sheet${props.full ? ' full' : ''}`} role="dialog" aria-label={props.title}>
        <div className="sheet-head">
          <div>{props.left}</div>
          <h2>{props.title}</h2>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {props.right ?? (
              <button className="nav-btn" onClick={props.onClose} aria-label="Schließen"><X size={22} /></button>
            )}
          </div>
        </div>
        <div className="sheet-body">{props.children}</div>
      </div>
    </>,
    document.body,
  );
}

export function DialogHost() {
  const req = useApp((s) => s.confirmReq);
  if (!req) return null;
  return createPortal(
    <div className="dialog-wrap" onClick={() => req.resolve(false)}>
      <div className="dialog" role="alertdialog" onClick={(e) => e.stopPropagation()}>
        <h3>{req.title}</h3>
        {req.message && <p>{req.message}</p>}
        <div className="dialog-btns">
          <button onClick={() => req.resolve(false)}>{req.cancelLabel ?? 'Abbrechen'}</button>
          <button className={req.destructive ? 'destructive' : ''} onClick={() => req.resolve(true)}>{req.confirmLabel ?? 'OK'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  return createPortal(
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === 'success' && <CheckCircle2 size={20} />}
          {t.kind === 'error' && <AlertTriangle size={20} />}
          <div className="grow">{t.text}</div>
          {t.action && (
            <button onClick={(e) => { e.stopPropagation(); t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Switch(props: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-label={props.label} checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function SwitchRow(props: { title: string; sub?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="row">
      <div className="row-main">
        <div className="row-title">{props.title}</div>
        {props.sub && <div className="row-sub">{props.sub}</div>}
      </div>
      <Switch checked={props.checked} onChange={props.onChange} label={props.title} disabled={props.disabled} />
    </div>
  );
}

export function Seg<T extends string>(props: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="tablist">
      {props.options.map((o) => (
        <button key={o.value} role="tab" aria-selected={props.value === o.value} className={props.value === o.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field(props: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; multiline?: boolean;
  required?: boolean; invalid?: boolean; list?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']; autoFocus?: boolean; readOnly?: boolean; rows?: number;
}) {
  const id = `f-${props.label.replace(/\W+/g, '-')}`;
  return (
    <div className={`field${props.invalid ? ' invalid' : ''}`}>
      <label htmlFor={id}>{props.label}{props.required && <span className="req"> *</span>}</label>
      {props.multiline ? (
        <textarea id={id} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} rows={props.rows ?? 3} autoFocus={props.autoFocus} readOnly={props.readOnly} />
      ) : (
        <input id={id} type={props.type ?? 'text'} value={props.value} placeholder={props.placeholder} list={props.list} inputMode={props.inputMode}
          onChange={(e) => props.onChange(e.target.value)} autoFocus={props.autoFocus} readOnly={props.readOnly} autoComplete="off" />
      )}
    </div>
  );
}

export function SelectField(props: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  const id = `s-${props.label.replace(/\W+/g, '-')}`;
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        {props.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}

export function Row(props: {
  title: ReactNode; sub?: ReactNode; value?: ReactNode; icon?: ReactNode; iconBg?: string; onClick?: () => void; chevron?: boolean; danger?: boolean; className?: string; right?: ReactNode; disabled?: boolean;
}) {
  const content = (
    <>
      {props.icon && <div className="row-icon" style={{ background: props.iconBg }}>{props.icon}</div>}
      <div className="row-main">
        <div className="row-title">{props.title}</div>
        {props.sub && <div className="row-sub">{props.sub}</div>}
      </div>
      {props.value !== undefined && <div className="row-value ellipsis">{props.value}</div>}
      {props.right}
      {(props.chevron ?? !!props.onClick) && <ChevronRight className="chev" size={20} />}
    </>
  );
  const cls = `row${props.icon ? ' icon-row' : ''}${props.danger ? ' danger' : ''} ${props.className ?? ''}`;
  return props.onClick ? (
    <button className={cls} onClick={props.onClick} disabled={props.disabled}>{content}</button>
  ) : (
    <div className={cls}>{content}</div>
  );
}

export function Empty(props: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {props.icon}
      <b>{props.title}</b>
      {props.text && <div>{props.text}</div>}
      {props.action}
    </div>
  );
}

export function Spinner({ large }: { large?: boolean }) {
  return <div className={`spinner${large ? ' lg' : ''}`} role="status" aria-label="Lädt" />;
}

export function Loading({ text }: { text?: string }) {
  return (
    <div className="loading-full">
      <Spinner large />
      {text && <div>{text}</div>}
    </div>
  );
}

/** Online / Offline / Synchronisierung ausstehend */
export function SyncPill() {
  const online = useApp((s) => s.online);
  const pending = useApp((s) => s.pendingJobs);
  if (!online) return <span className="pill off"><CloudOff size={14} />Offline{pending ? ` · ${pending} ausstehend` : ''}</span>;
  if (pending) return <span className="pill warn"><RefreshCw size={14} />{pending} ausstehend</span>;
  return <span className="pill ok"><Wifi size={14} />Online</span>;
}

export function Banner(props: { kind?: 'warn' | 'info' | 'danger' | 'ok'; icon?: ReactNode; children: ReactNode; onClick?: () => void }) {
  return (
    <div className={`banner ${props.kind ?? 'warn'}`} onClick={props.onClick} role={props.onClick ? 'button' : undefined}>
      {props.icon ?? <AlertTriangle size={20} />}
      <div className="grow">{props.children}</div>
      {props.onClick && <ChevronRight size={18} style={{ opacity: 0.5 }} />}
    </div>
  );
}

export function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
