#!/usr/bin/env python3
"""Production UI regression tests via ChromeDriver's W3C protocol; no Python packages needed."""
import json
import os
import pathlib
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

origin = sys.argv[1]
discord_mode = len(sys.argv) > 2 and sys.argv[2] == "discord"
driver = shutil.which('chromedriver')
if not driver:
    raise SystemExit('Install Chromium and matching chromedriver to run browserTest (required by gradle build).')
with socket.socket() as sock:
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
base = f'http://127.0.0.1:{port}'
session = None
checks = 0

def request(method, path, body=None):
    payload = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(base + path, data=payload, method=method, headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            result = json.load(response).get('value')
    except urllib.error.HTTPError as error:
        raise AssertionError(error.read().decode()) from error
    if isinstance(result, dict) and result.get('error'):
        raise AssertionError(result)
    return result

def command(path, body):
    return request('POST', '/session/' + session + path, body)

def js(script, *args):
    return command('/execute/sync', {'script': script, 'args': list(args)})

def wait(expression):
    end = time.monotonic() + 8
    while time.monotonic() < end:
        if js('return ' + expression):
            return
        time.sleep(.08)
    raise AssertionError('Timed out: ' + expression)

def element(selector):
    result = command('/element', {'using': 'css selector', 'value': selector})
    return result['element-6066-11e4-a52e-4f735466cecf']

def click(selector):
    command('/element/' + element(selector) + '/click', {})

def fill(selector, text):
    path = '/element/' + element(selector)
    command(path + '/clear', {})
    command(path + '/value', {'text': text})

def check(expression, message):
    global checks
    if not js('return ' + expression):
        raise AssertionError(message)
    checks += 1

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def login(user):
    if discord_mode:
        check("!document.querySelector('#discord-login').hidden && document.querySelector('#local-login').hidden", 'Discord-only login UI')
        check("document.querySelector('#discord-login').getAttribute('href')==='/api/auth/discord/start'", 'Discord login link')
        # Drive the real callback with a fake provider, without contacting Discord or using real credentials.
        import urllib.parse
        try:
            urllib.request.build_opener(NoRedirect).open(origin + '/api/auth/discord/start')
            raise AssertionError('Expected OAuth redirect')
        except urllib.error.HTTPError as response:
            if response.code != 302:
                raise
            state = urllib.parse.parse_qs(urllib.parse.urlparse(response.headers['Location']).query)['state'][0]
            cookie = response.headers['Set-Cookie'].split(';')[0].split('=', 1)[1]
        command('/cookie', {'cookie': {'name': 'panel_oauth', 'value': cookie, 'path': '/api/auth/discord', 'httpOnly': True, 'sameSite': 'Lax'}})
        command('/url', {'url': origin + '/api/auth/discord/callback?state=' + state + '&code=' + user})
        wait("!document.querySelector('#app').hidden && !document.querySelector('#refresh').disabled")
    else:
        fill('[name=username]', user)
        fill('[name=password]', 'browser-test-password')
        click('#login-form button')
        wait("!document.querySelector('#app').hidden && !document.querySelector('#refresh').disabled && document.querySelector('#staff-name').textContent===" + json.dumps(user))

with tempfile.TemporaryDirectory(prefix='panel-chrome-') as profile:
    log_path = pathlib.Path('build/reports/browser')
    log_path.mkdir(parents=True, exist_ok=True)
    for name in ('failure.png', 'failure.html'):
        (log_path / name).unlink(missing_ok=True)
    with (log_path / 'chromedriver.log').open('w') as log:
        process = subprocess.Popen([driver, f'--port={port}', '--allowed-ips=127.0.0.1'], stdout=log, stderr=log)
        try:
            for _ in range(100):
                try:
                    request('GET', '/status')
                    break
                except OSError:
                    time.sleep(.05)
            options = ['--headless=new', '--disable-dev-shm-usage', '--window-size=1440,1000', '--user-data-dir=' + profile]
            # Explicit opt-in for containers where Chromium's OS sandbox is unavailable.
            if os.environ.get('PANEL_TEST_NO_SANDBOX') == '1':
                options.append('--no-sandbox')
            result = request('POST', '/session', {'capabilities': {'alwaysMatch': {'browserName': 'chrome', 'goog:chromeOptions': {'args': options}, 'goog:loggingPrefs': {'browser': 'ALL'}}}})
            session = result['sessionId']
            command('/url', {'url': origin})
            wait("!document.querySelector('#login').hidden")
            js("Object.defineProperty(crypto, 'randomUUID', {value: undefined, configurable: true})")
            check("typeof crypto.randomUUID === 'undefined'", 'exercise LAN HTTP without randomUUID')
            login('admin')
            check("document.querySelector('#stat-online').textContent==='1'", 'online count')
            fill('#search', 'nobody')
            wait("document.querySelectorAll('.player-row').length===0")
            check("document.querySelector('#player-rows').textContent.includes('No players found')", 'empty search')
            fill('#search', '')
            click('[data-filter=offline]')
            check("document.querySelectorAll('.player-row').length===1 && document.querySelector('.player-row').textContent.includes('OfflinePlayer')", 'offline filter')
            click('[data-filter=online]')
            click('.player-row')
            wait("!!document.querySelector('[data-tab=security]')")
            click('[data-tab=inventory]')
            wait("!!document.querySelector('.item-art img') && document.querySelector('.item-art img').complete")
            check("document.querySelector('.item-art img').naturalWidth===64", 'resolved mod icon displays')
            check("document.querySelectorAll('.item-slot').length===3 && document.querySelectorAll('.empty-slot').length===1", 'slots including empty slots')
            check("!window.xss && !document.querySelector('.storage-grid img[src=x]')", 'item name escaped')
            click('.held-item summary')
            check("document.querySelector('.held-item').textContent.includes('95 / 100') && document.querySelector('.held-item').textContent.includes('Unbreaking 3')", 'item durability and enchantments')
            check("!document.querySelector('[data-item-icon=\"test:missing\"] img')", 'missing icon fallback')
            click('[data-tab=enderChest]')
            check("document.querySelector('.item-count').textContent==='×64'", 'Ender Chest stack count')
            click('[data-tab=curios]')
            check("document.querySelector('.detail-body').textContent.includes('Cosmetic') && document.querySelector('.detail-body').textContent.includes('Equipped')", 'Curios equipped and cosmetic groups')
            click('[data-tab=security]')
            check("document.querySelector('.detail-body').textContent.includes('<img src=x') && !window.xss && !document.querySelector('.detail-body img')", 'security evidence must render as text')
            click('[data-tab=notes]')
            click('[data-action=note-add]')
            fill('[name=text]', 'Automated staff note <script>window.xss=true</script>')
            click('#action-confirm')
            click('#submit-action')
            wait("!document.querySelector('#action-dialog').open && document.querySelector('.detail-body').textContent.includes('Automated staff note')")
            check("!window.xss && !document.querySelector('.detail-body script')", 'note XSS escaping')
            click('[data-action=punish]')
            fill('[name=reason]', 'Automated warning')
            click('#submit-action')
            check("document.querySelector('#action-dialog').open && !document.querySelector('#action-confirm').checkValidity()", 'confirmation required')
            click('#action-confirm')
            click('#submit-action')
            wait("!document.querySelector('#action-dialog').open")
            click('[data-tab=cases]')
            wait("document.querySelector('.detail-body').textContent.includes('Automated warning')")
            check("document.querySelectorAll('.detail-body .record').length===1", 'punishment appears once')
            click('[data-view=audit]')
            wait("document.querySelector('#audit-rows').textContent.includes('success')")
            check("document.querySelector('#audit-rows').textContent.includes('note-add')", 'audit includes note action')
            command('/window/rect', {'width': 390, 'height': 844})
            check("document.documentElement.scrollWidth<=window.innerWidth", 'mobile page fits viewport')
            click('#logout')
            wait("!document.querySelector('#login').hidden")
            login('viewer')
            click('[data-filter=online]')
            click('.player-row')
            wait("!!document.querySelector('[data-tab=notes]')")
            check("document.querySelector('#audit-nav').hidden && !document.querySelector('[data-action=punish]')", 'viewer controls restricted')
            click('[data-tab=notes]')
            check("!document.querySelector('[data-action=note-add]') && !document.querySelector('[data-action=note-edit]')", 'viewer notes read-only')
            click('[data-tab=inventory]')
            check("document.documentElement.scrollWidth<=window.innerWidth && !!document.querySelector('.storage-grid')", 'viewer mobile inventory fits')
            errors = command('/log', {'type': 'browser'})
            severe = [e for e in errors if e['level']=='SEVERE' and ('javascript' in e.get('source','') or 'Uncaught' in e['message'])]
            if severe:
                raise AssertionError(severe)
            checks += 1
            print(f'PASS: {checks} {"Discord" if discord_mode else "local"} browser checks (login, search, filters, notes, punishment, audit, XSS, mobile layout, viewer role).')
        except Exception:
            if session:
                try:
                    import base64
                    screenshot = request('GET', '/session/' + session + '/screenshot')
                    (log_path / 'failure.png').write_bytes(base64.b64decode(screenshot))
                    (log_path / 'failure.html').write_text(js('return document.documentElement.outerHTML'))
                except Exception:
                    pass
            raise
        finally:
            try:
                if session:
                    request('DELETE', '/session/' + session)
            finally:
                process.terminate()
                process.wait(timeout=10)
