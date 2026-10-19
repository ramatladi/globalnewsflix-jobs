#!/usr/bin/env python3
"""Choose the photo for each new Global Newsflix story.

Rule: the story's photo must come from a news outlet's own report of the story (one outlet is enough;
a photo several outlets used is preferred), with no watermark, no news company
branding and no added text. No library or stock photos are used.

The site lists stories waiting for a photo; for each one this script finds other outlets' reports,
collects their photos (shared ones first, then each outlet's lead photo) and offers them to the site, which
re-reads the registered story-source pages and checks native size, provenance, unrelated reuse,
branding and relevance with Gemma before publishing. Mistral is used only if the Gemma call
fails or returns an unusable response. A rejected or uncertain photo is held, and a story
with no accepted publisher photo is retried and left unpublished.

GitHub delivers only about one scheduled run an hour, so one run works for several minutes: it claims a
few stories at a time (only as many as it has free workers, so no claim sits waiting), picks up stories as
the writer saves them, and polls while the site says more are due soon. When it stops claiming it tells
the workflow whether to start the next run straight away (more work coming) or to let the schedule and
the news collection start it later (the writer is quiet and nothing is due).
"""
import os, sys, time
from collections import Counter, deque
from concurrent.futures import ThreadPoolExecutor, wait, FIRST_COMPLETED
import make_video as mv

# Photos offered per story: the best few picture groups, and a few copies of each (an outlet's own size first).
GROUPS_PER_STORY = 6
URLS_PER_GROUP = 3


def setting(name, default):
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return float(default)


def handle(art, stop_at=None):
    if stop_at and time.time() > stop_at:
        why = "photo run ended before this story was checked"
        try: mv.site_api("/api/photos/none", {"article_id": art["id"], "photo_token": art.get("photo_token"), "why": why}, timeout=60)
        except Exception as e: print("could not record", e)
        return "time"
    tag = art["id"][:10] + "_"
    try:
        # Only an outlet's lead photo for the story, or a photo several outlets used, can illustrate it on the site,
        # and only copies the site's own native-size gate accepts are worth offering.
        pool = [c for c in mv.corroborated_media(art, videos=False, tag=tag)
                if c["kind"] == "photo" and c.get("urls") and (c["lead"] or c["outlets"] > 1)]
    except Exception as e:
        print("failed", art["id"], e); return "error"
    result, why = "none", "no usable photo in the outlets' reports"
    for c in pool[:GROUPS_PER_STORY]:
        for url in c.get("urls", [])[:URLS_PER_GROUP]:
            if stop_at and time.time() > stop_at:
                break
            # A slow check must not outlive the run: the claim is released with the failure below and retried.
            wait_for = 180 if not stop_at else max(30, min(180, stop_at + 60 - time.time()))
            try:
                r = mv.site_api("/api/photos/set", {"article_id": art["id"], "photo_token": art.get("photo_token"), "image": url, "credit": c["credit"].removeprefix("Published by ")}, timeout=wait_for)
            except Exception as e:
                r = {"ok": False, "why": str(e)[:80]}
            if r.get("ok"):
                result = "set"; break
            why = r.get("why") or why
        if result == "set": break
    if result != "set":
        try: mv.site_api("/api/photos/none", {"article_id": art["id"], "photo_token": art.get("photo_token"), "why": why}, timeout=60)
        except Exception as e: print("could not record", e)
    for f in mv.OUT.glob(f"news_{tag}*"):
        try: f.unlink()
        except Exception: pass
    print(f"{result:4} | {art['title'][:70]} | {why if result != 'set' else ''}", flush=True)
    return result


def work_expected(resp, idle_seconds):
    """More stories will need a photo soon: the writer saved some recently, or a retry falls due shortly."""
    if not isinstance(resp, dict) or resp.get("waiting_for_migration"):
        return False
    outlook = resp.get("outlook")
    if not isinstance(outlook, dict):
        return False
    if (outlook.get("written_recent") or 0) > 0:
        return True
    due = outlook.get("next_due_in_ms")
    return isinstance(due, (int, float)) and due <= idle_seconds * 1000


def write_output(**values):
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            for k, v in values.items():
                f.write(f"{k}={v}\n")


def run(clock=time.time, sleep=time.sleep):
    """Claim and check stories until the claim window closes or no more work is expected. Returns (claimed, results, chain)."""
    start = clock()
    claim_until = start + setting("CLAIM_MINUTES", "9") * 60
    stop_at = start + setting("STOP_MINUTES", "11") * 60
    parallel = max(1, int(setting("PARALLEL", "4")))
    poll = max(5.0, setting("POLL_SECONDS", "45"))
    idle_seconds = setting("IDLE_SECONDS", "360")
    pending, running, results = deque(), set(), Counter()
    claimed, errors, expected, next_poll, chain = 0, 0, False, start, None
    with ThreadPoolExecutor(parallel) as ex:
        while True:
            now = clock()
            free = parallel - len(running) - len(pending)
            if now < claim_until and free > 0 and now >= next_poll:
                try:
                    resp = mv.site_api("/api/photos/queue", {"limit": free}, timeout=90)
                    errors = 0
                except Exception as e:
                    # A brief site outage must not end the run; five failures in a row end it, and it chains
                    # only if the last answer it did get expected more work.
                    errors += 1
                    print("queue unavailable", str(e)[:120], flush=True)
                    resp = None
                    if errors >= 5:
                        claim_until = now
                stories = (resp or {}).get("stories") or []
                if resp is not None:
                    expected = work_expected(resp, idle_seconds)
                if stories:
                    print(f"{len(stories)} stories need a photo", flush=True)
                claimed += len(stories)
                pending.extend(stories)
                next_poll = now if stories else now + (poll if resp is not None else min(poll, 15.0 * errors))
            while pending and len(running) < parallel:
                running.add(ex.submit(handle, pending.popleft(), stop_at))
            if chain is None and (clock() >= claim_until or (not running and not pending and not expected and not errors)):
                # Decide the hand-off as soon as claiming stops, so it survives a slow last story.
                chain = expected or (claimed > 0 and clock() >= claim_until)
                write_output(chain="true" if chain else "false")
            if running:
                # With every worker busy only a finished story matters; otherwise wake for the next poll too.
                idle_wait = 15.0 if len(running) >= parallel or chain is not None else max(1.0, min(15.0, next_poll - clock()))
                done, running = wait(running, timeout=idle_wait, return_when=FIRST_COMPLETED)
                for f in done:
                    try: results[f.result()] += 1
                    except Exception as e: results["error"] += 1; print("story failed", e, flush=True)
                continue
            if pending:
                continue
            if chain is not None:
                break
            sleep(max(1.0, min(poll, next_poll - clock())))
    return claimed, results, bool(chain)


def main():
    claimed, results, chain = run()
    print(dict(results), f"claimed={claimed}", "next run starts now" if chain else "chain stops until the next start", flush=True)
    write_output(stories=claimed)
    # Keep processing independent jobs, then surface maintenance problems as a
    # failed workflow. A queue response must not hide an unhealthy registry.
    health = mv.site_api("/api/photos/health", {})
    if health.get("ok") is not True:
        raise RuntimeError("Photo maintenance health check failed")


if __name__ == "__main__":
    main()
