import socket, sys
try:
    a, b = socket.socketpair(socket.AF_UNIX)
    a.send(b'hello'); a.close(); b.close()
    print('UNIX_SOCKETPAIR_OK', file=sys.stderr)
except Exception as e:
    print('UNIX_SOCKETPAIR_FAIL:', e, file=sys.stderr)
