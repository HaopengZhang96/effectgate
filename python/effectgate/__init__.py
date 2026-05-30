import functools
import json
import os
import subprocess
import sys


class EffectGateBlocked(RuntimeError):
    pass


def effect(effect_id):
    def decorate(fn):
        @functools.wraps(fn)
        def wrapped(*args, **kwargs):
            check(effect_id, args=[*args], kwargs=kwargs)
            return fn(*args, **kwargs)

        return wrapped

    return decorate


def check(effect_id, args=None, kwargs=None):
    payload = {"args": args or [], "kwargs": kwargs or {}}
    result = subprocess.run(
        [_effectgate_bin(), "check", effect_id, "--args-json", json.dumps(payload, default=str)],
        text=True,
        capture_output=True,
        cwd=os.getcwd(),
    )
    if result.returncode == 0:
        return True
    sys.stderr.write(result.stderr or result.stdout or f"EffectGate blocked {effect_id}\n")
    raise SystemExit(result.returncode)


def install_profiler():
    def profiler(frame, event, arg):
        if event != "call":
            return profiler
        name = frame.f_code.co_name
        filename = frame.f_code.co_filename
        result = subprocess.run(
            [_effectgate_bin(), "check-keyword", name, "--file", filename],
            text=True,
            capture_output=True,
            cwd=os.getcwd(),
        )
        if result.returncode in (42, 43):
            sys.stderr.write(result.stderr or result.stdout)
            raise SystemExit(result.returncode)
        return profiler

    sys.setprofile(profiler)
    return profiler


def _effectgate_bin():
    return os.environ.get("EFFECTGATE_BIN", "effectgate")
