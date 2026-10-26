"""Start the local workbench independently of the terminal/chat session."""
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

root = Path(__file__).resolve().parent
url = 'http://127.0.0.1:8765/'

def healthy():
    try:
        with urlopen(url + 'api/state', timeout=2) as response:
            return response.status == 200
    except Exception:
        return False

if healthy():
    print('Offer Lai 已运行：' + url)
    raise SystemExit(0)
with socket.socket() as probe:
    if probe.connect_ex(('127.0.0.1', 8765)) == 0:
        raise SystemExit('8765端口被其他服务占用，请检查后重试。')
(root / 'data').mkdir(exist_ok=True)
with (root / 'data/server.log').open('ab') as log:
    process = subprocess.Popen([sys.executable, str(root / 'server.py')], cwd=root,
        stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
        start_new_session=True, close_fds=True)
for _ in range(30):
    if healthy():
        print('Offer Lai 已启动（独立后台进程）：' + url)
        raise SystemExit(0)
    if process.poll() is not None:
        break
    time.sleep(.2)
raise SystemExit('服务未能启动，请查看data/server.log。')
