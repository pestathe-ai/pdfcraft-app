import http.server, sys, os, gzip, io
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy','same-origin')
        self.send_header('Cross-Origin-Embedder-Policy','require-corp')
        self.send_header('Cross-Origin-Resource-Policy','cross-origin')
        self.send_header('Cache-Control','no-cache')
        super().end_headers()
    def log_message(self,*a): pass
    def send_head(self):
        path=self.translate_path(self.path)
        if not os.path.exists(path) and os.path.exists(path+'.gz'):
            data=gzip.open(path+'.gz').read()
            self.send_response(200); self.send_header('Content-Type','application/octet-stream'); self.send_header('Content-Length',str(len(data))); self.end_headers()
            return io.BytesIO(data)
        return super().send_head()
H.extensions_map.update({'.wasm':'application/wasm','.mjs':'text/javascript','.js':'text/javascript'})
os.chdir(sys.argv[1])
http.server.ThreadingHTTPServer(('127.0.0.1',int(sys.argv[2])),H).serve_forever()
