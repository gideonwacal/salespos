"""Operational endpoints — not part of the product API."""

from django.http import JsonResponse


def health(request):
    """Liveness probe for the host's health check.

    Deliberately does not touch the database. Render polls this every few
    seconds, and on a serverless Postgres that autosuspends when idle (Neon's
    free tier) a query here would keep the database awake permanently and burn
    the free compute allowance. The API's own endpoints prove the database
    works; this only proves the process is up and serving.
    """
    return JsonResponse({"status": "ok"})
