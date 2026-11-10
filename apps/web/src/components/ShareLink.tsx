import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function ShareLink({ url, label }: { url: string; label: string }) {
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCopied(false);
    setError(null);
    void QRCode.toDataURL(url, { margin: 1, width: 180, color: { dark: "#121410", light: "#ffffff" } }).then(setQr).catch(() => setQr(null));
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true); setError(null);
    } catch { setError("Could not copy. Select and copy the link above."); }
  }

  async function share() {
    setError(null);
    if (!navigator.share) {
      await copy();
      return;
    }
    try {
      await navigator.share({ title: "Blackthorn Rugby", text: label, url });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("Could not open the share sheet.");
    }
  }

  return (
    <div className="flex flex-col gap-s2">
      <label className="flex flex-col gap-s1 text-sm text-quiet">
        {label}
        <input readOnly value={url} aria-label={label} className="rounded-md border border-line bg-canvas px-s2 py-s1 text-base text-ink" />
      </label>
      <div className="flex flex-wrap gap-s1">
        <button type="button" onClick={() => void copy()} className="rounded-md bg-gold px-s2 py-s1 font-heading font-semibold text-forest">
          {copied ? "Copied" : "Copy link"}
        </button>
        <button type="button" onClick={() => void share()} className="rounded-md border border-line px-s2 py-s1 font-heading font-semibold">
          Share
        </button>
      </div>
      {qr ? <img src={qr} alt="" className="h-32 w-32 rounded-md bg-white p-s1" /> : null}
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
    </div>
  );
}
