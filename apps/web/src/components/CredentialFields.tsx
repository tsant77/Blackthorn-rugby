import { useId } from "react";
export interface CredentialValues { username: string; password: string; confirmPassword: string }

export function CredentialFields({ values, onChange, confirm = true, username = true }: {
  values: CredentialValues; onChange: (values: CredentialValues) => void; confirm?: boolean; username?: boolean;
}) {
  const usernameId = useId();
  return <>
    {username ? <div className="field"><label htmlFor={usernameId}>Username</label>
      <input id={usernameId} required name="username" autoComplete="username" autoCapitalize="none" spellCheck={false}
        minLength={3} maxLength={30} pattern="[A-Za-z0-9][A-Za-z0-9_.-]{2,29}" value={values.username}
        onChange={e => onChange({ ...values, username: e.target.value })} aria-describedby={usernameId + "-help"} />
      <span id={usernameId + "-help"} className="text-xs text-quiet">3–30 letters, numbers, dots, underscores, or hyphens.</span>
    </div> : null}
    <label className="field">{confirm ? "Password (12–128 characters)" : "Password"}
      <input type="password" name="password" required autoComplete={confirm ? "new-password" : "current-password"}
        minLength={confirm ? 12 : undefined} maxLength={128} value={values.password}
        onChange={e => onChange({ ...values, password: e.target.value })} />
    </label>
    {confirm ? <label className="field">Confirm password
      <input type="password" name="confirmPassword" required autoComplete="new-password" minLength={12} maxLength={128}
        value={values.confirmPassword} onChange={e => onChange({ ...values, confirmPassword: e.target.value })} />
    </label> : null}
  </>;
}
