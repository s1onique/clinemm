import http.server, socketserver
class H(http.server.BaseHTTPRequestHandler):
    def do_GET(s):
        s.send_response(200); s.send_header('Content-Type','text/plain'); s.end_headers()
        s.wfile.write(b'INSIDE_HTTP_SERVER_HIT\n')
    def log_message(*a, **k): pass
with socketserver.TCPServer(('127.0.0.1', 18929), H) as s:
    s.serve_forever()
