#!/usr/bin/env python3
"""
Local dev server with HTTP Range request support (required for video seeking).
Usage: python serve.py [port]
"""
import http.server
import json
import os
import sys


class RangeRequestHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path.split('?')[0])

        if not os.path.isfile(path):
            return super().send_head()

        range_header = self.headers.get('Range')
        if not range_header:
            return super().send_head()

        size = os.path.getsize(path)
        try:
            byte_range = range_header.strip().removeprefix('bytes=')
            start_str, end_str = byte_range.split('-')
            start = int(start_str)
            end = int(end_str) if end_str else size - 1
        except (ValueError, AttributeError):
            self.send_error(400, 'Bad Range header')
            return None

        end = min(end, size - 1)
        length = end - start + 1

        f = open(path, 'rb')
        f.seek(start)

        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(length))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        return f

    def log_message(self, fmt, *args):
        # Suppress noisy request logs; only show errors
        if args and str(args[1]) not in ('200', '206', '304'):
            super().log_message(fmt, *args)


if __name__ == '__main__':
    # Serve THIS dashboard, not whatever directory the shell happens to be in.
    #
    # SimpleHTTPRequestHandler serves the current working directory, so running
    # `python /path/to/other-dashboard/serve.py` from here used to serve the
    # wrong study silently -- same layout, same filenames, different data, and
    # nothing on screen to say so. Anchoring to the script's own directory is
    # what makes "run this dashboard" mean what it says.
    project_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(project_dir)

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000

    label = os.path.basename(project_dir)
    try:
        with open('config.json') as fh:
            label = json.load(fh).get('title') or label
    except (OSError, ValueError):
        print("warning: no readable config.json here -- is this a dashboard directory?", flush=True)

    try:
        server = http.server.HTTPServer(('', port), RangeRequestHandler)
    except OSError as exc:
        # The other half of the same confusion: port already taken by an older
        # server for a different dashboard, so the browser shows that one.
        print(f'error: cannot listen on port {port}: {exc}', flush=True)
        print(f'       something else is already serving it. Try: python serve.py {port + 1}', flush=True)
        sys.exit(1)

    # flush: these three lines are the whole defence against serving the wrong
    # study, and Python buffers stdout when it is not a terminal -- which is
    # exactly the case when the server is launched from an IDE or a wrapper.
    print(f'Serving "{label}"', flush=True)
    print(f'  from {project_dir}', flush=True)
    print(f'  at   http://localhost:{port}', flush=True)
    server.serve_forever()
