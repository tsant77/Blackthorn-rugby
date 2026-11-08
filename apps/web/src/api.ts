export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new ApiError(body.error ?? "Something went wrong.");
  }
  return response.json() as Promise<T>;
}

export interface Me {
  user: { id: string; email: string; name: string; emailNotifications: boolean };
  membership: { id: string; role: "player" | "coach" | "admin"; clubId: string; status?: string };
  pendingApproval?: boolean;
  profile: {
    id: string;
    rosterName: string;
    positionId: string | null;
    groupId: string | null;
    injuryStatus: "available" | "limited" | "out";
    injuryNote: string | null;
  } | null;
  needsOnboarding: boolean;
}

export interface RosterPosition {
  id: string;
  name: string;
  group_id: string;
  group_name: string;
}
