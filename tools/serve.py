"""Local dev server for Operation Dino Park with caching disabled."""
import functools
import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

    def log_message(self, *args):
        pass

    # Dev-only: tools/fbxview.html posts converted models here. Only .glb files under assets/models/.
    def do_POST(self):
        rel = self.path.split("?", 1)[0].lstrip("/")
        dest = os.path.realpath(os.path.join(ROOT, rel))
        allowed = os.path.realpath(os.path.join(ROOT, "assets", "models"))
        if not rel.endswith(".glb") or not dest.startswith(allowed + os.sep):
            self.send_response(403)
            self.end_headers()
            return
        n = int(self.headers.get("Content-Length", 0))
        if n <= 0 or n > 20_000_000:
            self.send_response(400)
            self.end_headers()
            return
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(self.rfile.read(n))
        self.send_response(204)
        self.end_headers()


handler = functools.partial(NoCache, directory=ROOT)
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()
