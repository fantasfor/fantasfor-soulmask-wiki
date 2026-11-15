# Servidor local para desenvolvimento: igual ao "python -m http.server", mas sem cache
# (assim o navegador sempre pega a versão mais nova dos .js/.css/.json).
#   python tools/dev_server.py 8765
import functools
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class Server(http.server.ThreadingHTTPServer):
    # a fila padrão aceita só 5 conexões esperando; o site pede ~25 arquivos de CSS de uma vez
    # (@import) e o Windows recusava o resto -> página "sem estilo" de vez em quando
    request_queue_size = 256
    daemon_threads = True


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    handler = functools.partial(NoCacheHandler, directory=root)
    print("Servindo %s em http://localhost:%d" % (root, port))
    Server(("", port), handler).serve_forever()
