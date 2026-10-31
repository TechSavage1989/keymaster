"""Read-only GitHub Releases update discovery; NEVER downloads or installs."""
from __future__ import annotations

import json
import time
from packaging.version import Version, InvalidVersion
from PySide6 import QtCore, QtNetwork

from . import __version__

FEED = "https://api.github.com/repos/TechSavage1989/keymaster/releases?per_page=20"


class UpdateMonitor(QtCore.QObject):
    available = QtCore.Signal(str, str, str)
    status_changed = QtCore.Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self.manager = QtNetwork.QNetworkAccessManager(self)
        self.last_check = 0.0
        self.retry_at = 0.0
        self.in_flight = False
        self.etag = None
        self.cached = None
        self.timer = QtCore.QTimer(self)
        self.timer.setInterval(5 * 60 * 1000)
        self.timer.timeout.connect(lambda: self.check(min_interval=300))
        self.timer.start()

    def check(self, min_interval: int = 30):
        now = time.monotonic()
        if self.in_flight or now < self.retry_at or now - self.last_check < min_interval:
            return
        self.last_check = now
        self.in_flight = True
        self.status_changed.emit("Checking for updates...")
        request = QtNetwork.QNetworkRequest(QtCore.QUrl(FEED))
        request.setRawHeader(b"Accept", b"application/vnd.github+json")
        request.setRawHeader(b"User-Agent", b"Keymaster-Windows")
        if self.etag:
            request.setRawHeader(b"If-None-Match", self.etag)
        request.setTransferTimeout(10000)
        reply = self.manager.get(request)
        reply.finished.connect(lambda: self._finished(reply))

    def _finished(self, reply: QtNetwork.QNetworkReply):
        self.in_flight = False
        code = reply.attribute(QtNetwork.QNetworkRequest.Attribute.HttpStatusCodeAttribute)
        error = reply.error()
        if code == 304 and self.cached is not None:
            releases = self.cached
        elif error == QtNetwork.QNetworkReply.NetworkError.NoError and code == 200:
            try:
                releases = json.loads(bytes(reply.readAll()).decode("utf-8"))
                if not isinstance(releases, list):
                    raise ValueError("Unexpected response")
                self.cached = releases
                self.etag = bytes(reply.rawHeader(b"ETag")) or None
            except (ValueError, UnicodeDecodeError):
                self.status_changed.emit("Could not parse update information.")
                reply.deleteLater()
                return
        else:
            if code in (403, 429):
                wait = bytes(reply.rawHeader(b"Retry-After"))
                try:
                    seconds = min(3600, max(60, int(wait)))
                except ValueError:
                    seconds = 600
                self.retry_at = time.monotonic() + seconds
                self.status_changed.emit("Update service is rate limited; try again later.")
            else:
                self.status_changed.emit("Update status unknown (offline or service unavailable).")
            reply.deleteLater()
            return
        reply.deleteLater()
        self._report(releases)

    def _report(self, releases: list):
        current = Version(__version__)
        candidates = []
        for release in releases:
            if release.get("draft") or not release.get("html_url", "").startswith(
                "https://github.com/TechSavage1989/keymaster/releases/tag/"
            ):
                continue
            try:
                version = Version(str(release.get("tag_name", "")).lstrip("v"))
            except InvalidVersion:
                continue
            if version > current:
                candidates.append((version, release))
        if not candidates:
            self.status_changed.emit("No newer published release found.")
            return
        newest, release = max(candidates, key=lambda record: record[0])
        body = str(release.get("body") or "").strip()
        notes = "\n".join(line.strip(" -*") for line in body.splitlines()
                          if line.strip() and not line.startswith("#"))[:400]
        self.available.emit(str(newest), release["html_url"], notes)
        self.status_changed.emit(f"Update available: {newest}")
