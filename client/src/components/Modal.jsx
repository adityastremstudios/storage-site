import React from 'react';

export default function Modal({ title, children, footer, onClose, wide }) {
  return (
    <div className="overlaybg" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="mhead">
          <h3>{title}</h3>
          <div className="grow" />
          <button className="btn sm" onClick={onClose}>Close</button>
        </div>
        <div className="mbody">{children}</div>
        {footer && <div className="mfoot">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children }) {
  return <label className="f"><span>{label}</span>{children}</label>;
}
