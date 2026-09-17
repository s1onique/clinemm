import socket, sys
for path in ['/var/run/filesystemui.socket', '/var/run/portmap.socket']:
    try:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(1.0)
        s.connect(path)
        s.close()
        print('UNIX_SOCKET_CONNECTED:', path, file=sys.stderr)
    except Exception as e:
        print('UNIX_SOCKET_FAIL:', path, repr(e), file=sys.stderr)
