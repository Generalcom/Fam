"""The Supabase side: pending submissions, their photos, and writing the result. Uses the service role key, which
bypasses row level security, so it must only ever live on this server (never in the app)."""

from __future__ import annotations

from typing import Any

import httpx

BUCKET = "kyc"


class Store:
    def __init__(self, url: str, service_key: str, timeout: float = 30.0, transport: httpx.BaseTransport | None = None) -> None:
        self._http = httpx.Client(
            base_url=url.rstrip("/"),
            headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"},
            timeout=timeout,
            transport=transport,
        )

    def pending(self, limit: int) -> list[dict[str, Any]]:
        """Submissions waiting for the automatic check, oldest first."""
        res = self._http.get(
            "/rest/v1/kyc_submissions",
            params={"select": "*", "status": "eq.pending", "checked_at": "is.null", "order": "submitted_at.asc", "limit": str(limit)},
        )
        res.raise_for_status()
        return res.json()

    def photo(self, path: str) -> bytes:
        res = self._http.get(f"/storage/v1/object/authenticated/{BUCKET}/{path}")
        res.raise_for_status()
        return res.content

    def record(self, row: dict[str, Any], patch: dict[str, Any]) -> bool:
        """Writes the result, but only onto the same submission that was checked (not a newer one sent meanwhile).
        Returns False when that submission is no longer there to update."""
        res = self._http.patch(
            "/rest/v1/kyc_submissions",
            params={"user_id": f"eq.{row['user_id']}", "submitted_at": f"eq.{row['submitted_at']}", "status": "eq.pending"},
            json=patch,
            headers={"Prefer": "return=representation"},
        )
        res.raise_for_status()
        return len(res.json()) > 0
