# Copyright 2025 The HuggingFace Inc. team. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
LeLab launcher.

Default mode: starts the FastAPI backend on :8000, which serves the
pre-built frontend at /. Opens the user's browser to the local app.

--dev mode: spawns the Vite dev server (frontend/, port 8080) for HMR
and starts uvicorn with --reload. Opens the browser to :8080.
"""

import argparse
import logging
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).parent.parent.parent
FRONTEND_PATH = PROJECT_ROOT / "frontend"
FRONTEND_DIST = FRONTEND_PATH / "dist"
BACKEND_PORT = 8000
FRONTEND_DEV_PORT = 8080


# Bind addresses reachable from this machine on loopback; anything else
# (e.g. a LAN IP with a TLS cert issued for it) must be polled/opened as-is.
_LOOPBACK_REACHABLE_HOSTS = ("127.0.0.1", "localhost", "0.0.0.0", "::")


def _connect_host(bind_host: str) -> str:
    """Host to poll/open for a given bind address."""
    return "localhost" if bind_host in _LOOPBACK_REACHABLE_HOSTS else bind_host


def _wait_for_port(port: int, timeout: int = 30, host: str = "localhost") -> bool:
    for _ in range(timeout):
        try:
            with socket.create_connection((host, port), timeout=1):
                return True
        except OSError:
            time.sleep(1)
    return False


def _open_browser_when_ready(scheme: str = "http", host: str = "127.0.0.1"):
    """Background-thread helper: poll the port, open the browser when up.

    Wildcard/loopback binds are reached via localhost; a specific LAN bind
    (e.g. with a TLS cert for that IP) is polled and opened on that host so
    the URL matches where the server actually listens.
    """
    target = _connect_host(host)
    for _ in range(60):
        try:
            with socket.create_connection((target, BACKEND_PORT), timeout=0.5):
                pass
        except OSError:
            time.sleep(0.5)
            continue
        logger.info("🌐 Opening browser...")
        webbrowser.open(f"{scheme}://{target}:{BACKEND_PORT}/")
        return


def _run_prod(host: str, ssl_certfile: str | None, ssl_keyfile: str | None):
    """Serve built frontend from backend on a single port."""
    if not FRONTEND_DIST.exists():
        logger.error(f"❌ Built frontend not found at {FRONTEND_DIST}")
        logger.error("   Run `npm run build` in frontend/ first, or use `lelab --dev`.")
        sys.exit(1)

    scheme = "https" if ssl_certfile and ssl_keyfile else "http"
    logger.info("🚀 Starting LeLab on %s://%s:%d ...", scheme, host, BACKEND_PORT)

    threading.Thread(target=_open_browser_when_ready, args=(scheme, host), daemon=True).start()

    # Run uvicorn in the main thread so its native SIGINT handler works,
    # and bound graceful shutdown so a stuck WebSocket can't hang Ctrl+C.
    uvicorn.run(
        "lelab.server:app",
        host=host,
        port=BACKEND_PORT,
        log_level="info",
        reload=False,
        timeout_graceful_shutdown=2,
        ssl_certfile=ssl_certfile,
        ssl_keyfile=ssl_keyfile,
    )


def _run_dev(host: str, ssl_certfile: str | None, ssl_keyfile: str | None):
    """Vite dev server (HMR) + uvicorn --reload."""
    if not FRONTEND_PATH.exists():
        logger.error(f"❌ Frontend not found at {FRONTEND_PATH}")
        sys.exit(1)

    logger.info("📦 Installing frontend deps...")
    subprocess.run(["npm", "install"], check=True, cwd=FRONTEND_PATH)

    logger.info("🎨 Starting Vite dev server (port %d)...", FRONTEND_DEV_PORT)
    frontend_process = subprocess.Popen(
        ["npm", "run", "dev"],
        cwd=FRONTEND_PATH,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )

    if not _wait_for_port(FRONTEND_DEV_PORT):
        logger.error("❌ Frontend never came up")
        frontend_process.terminate()
        sys.exit(1)

    logger.info("🚀 Starting backend (port %d) with --reload...", BACKEND_PORT)
    backend_cmd = [
        sys.executable,
        "-m",
        "uvicorn",
        "lelab.server:app",
        "--host",
        host,
        "--port",
        str(BACKEND_PORT),
        "--reload",
    ]
    if ssl_certfile:
        backend_cmd += ["--ssl-certfile", ssl_certfile]
    if ssl_keyfile:
        backend_cmd += ["--ssl-keyfile", ssl_keyfile]
    backend_process = subprocess.Popen(
        backend_cmd,
        cwd=PROJECT_ROOT,
        env=os.environ.copy(),
        start_new_session=True,
    )

    if not _wait_for_port(BACKEND_PORT, timeout=15, host=_connect_host(host)):
        logger.error("❌ Backend never came up")
        for p in (backend_process, frontend_process):
            try:
                os.killpg(os.getpgid(p.pid), signal.SIGTERM)
            except Exception:
                p.terminate()
        sys.exit(1)

    logger.info("🌐 Opening browser...")
    webbrowser.open(f"http://localhost:{FRONTEND_DEV_PORT}/")

    logger.info("✅ Dev mode running — Ctrl+C to stop")
    logger.info("   Frontend: http://localhost:%d", FRONTEND_DEV_PORT)
    logger.info("   Backend:  http://localhost:%d", BACKEND_PORT)

    def shutdown(signum, frame):
        logger.info("🛑 Shutting down...")
        for name, p in [("backend", backend_process), ("frontend", frontend_process)]:
            try:
                os.killpg(os.getpgid(p.pid), signal.SIGTERM)
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(os.getpgid(p.pid), signal.SIGKILL)
                except Exception:
                    p.kill()
            except Exception:
                pass
            logger.info(f"  ✅ {name} stopped")
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    while True:
        time.sleep(2)
        if backend_process.poll() is not None:
            logger.error("❌ Backend died")
            shutdown(None, None)
        if frontend_process.poll() is not None:
            logger.error("❌ Frontend died")
            shutdown(None, None)


def main():
    parser = argparse.ArgumentParser(prog="lelab", description="Run LeLab")
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Dev mode: Vite HMR + uvicorn --reload (requires Node.js)",
    )
    parser.add_argument(
        "--host",
        default=os.environ.get("LELAB_HOST", "127.0.0.1"),
        help="Bind address for the backend (env LELAB_HOST). Use 0.0.0.0 for LAN access.",
    )
    parser.add_argument(
        "--ssl-certfile",
        default=os.environ.get("LELAB_SSL_CERTFILE"),
        help="TLS certificate file for HTTPS (env LELAB_SSL_CERTFILE)",
    )
    parser.add_argument(
        "--ssl-keyfile",
        default=os.environ.get("LELAB_SSL_KEYFILE"),
        help="TLS private key file for HTTPS (env LELAB_SSL_KEYFILE)",
    )
    args = parser.parse_args()

    if args.dev:
        _run_dev(args.host, args.ssl_certfile, args.ssl_keyfile)
    else:
        _run_prod(args.host, args.ssl_certfile, args.ssl_keyfile)


if __name__ == "__main__":
    main()
