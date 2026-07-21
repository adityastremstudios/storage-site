import React, { useState } from 'react';
import { useAuth } from '../auth.jsx';

export default function Login() {
  const { login } = useAuth();
  const [emailOrUsername, setU] = useState('');
  const [password, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(''); setBusy(true);
    try { await login(emailOrUsername, password); }
    catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="loginwrap">
      <div className="loginbox">
        <div className="brand"><div className="mark" style={{ width: 34, height: 34 }} /></div>
        <h1>UETMS Control</h1>
        <p>Sign in to manage tournaments, matches and broadcasts.</p>
        {err && <div className="err">{err}</div>}
        <label className="f"><span>Email or username</span>
          <input value={emailOrUsername} onChange={(e) => setU(e.target.value)} autoFocus
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        <label className="f"><span>Password</span>
          <input type="password" value={password} onChange={(e) => setP(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </label>
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy} onClick={submit}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </div>
  );
}
