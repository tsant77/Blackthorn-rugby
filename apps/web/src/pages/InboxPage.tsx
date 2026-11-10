import { useEffect, useState } from "react";
import { api, ApiError } from "../api";

interface Note {
  id: string;
  kind: string;
  title: string;
  body: string;
  read_at: number | null;
  created_at: number;
}

export function InboxPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const body = await api<{ notifications: Note[]; unread: number }>("/api/notifications");
    setNotes(body.notifications);
    setUnread(body.unread);
  }

  useEffect(() => {
    void load().catch((caught: unknown) => setError(caught instanceof ApiError ? caught.message : "Could not load notifications."));
  }, []);

  async function mark(id: string) {
    await api(`/api/notifications/${id}/read`, { method: "POST" });
    await load();
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-s3 px-s2 py-s4">
      <h1 className="font-heading text-2xl font-semibold">Inbox</h1>
      <p className="text-quiet">{unread} unread</p>
      {error ? <p role="alert" className="text-gold-soft">{error}</p> : null}
      {unread > 0 ? (
        <button type="button" className="w-fit text-sm text-sage" onClick={() => void api("/api/notifications/read-all", { method: "POST" }).then(load)}>
          Mark all read
        </button>
      ) : null}
      {notes.length === 0 ? <p className="text-quiet">No notifications yet.</p> : null}
      <ul className="flex flex-col gap-s2">
        {notes.map((note) => (
          <li key={note.id} className={`rounded-md border p-s2 ${note.read_at ? "border-line bg-raised" : "border-gold bg-overlay"}`}>
            <p className="font-heading font-semibold">{note.title}</p>
            <p className="text-sm">{note.body}</p>
            {note.read_at ? <p className="text-sm text-quiet">Read</p> : (
              <button type="button" className="mt-s1 text-sm text-sage" onClick={() => void mark(note.id)}>Mark read</button>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
