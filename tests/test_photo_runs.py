"""The chained photo run: it keeps claiming while more stories are coming, never holds unclaimed work,
hands off to the next run only when work is expected, and offers only copies the site can accept."""
import io
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
_previous_cwd = os.getcwd()
os.chdir(tempfile.mkdtemp())
import make_video as mv
import make_photos as mp
from PIL import Image, ImageDraw
os.chdir(_previous_cwd)


class FakeClock:
    def __init__(self):
        self.t = 1_000_000.0
        self.slept = []

    def __call__(self):
        return self.t

    def sleep(self, seconds):
        self.slept.append(seconds)
        self.t += seconds


def outlook(written=0, due_ms=None):
    return {'waiting': 0, 'next_due_in_ms': due_ms, 'written_recent': written}


ENV = {'CLAIM_MINUTES': '9', 'STOP_MINUTES': '11', 'PARALLEL': '3', 'POLL_SECONDS': '45', 'IDLE_SECONDS': '360'}


class ChainedRun(unittest.TestCase):
    def run_with(self, responses, handle=None):
        clock, calls, handled = FakeClock(), [], []
        def api(path, payload, **kw):
            calls.append((path, payload))
            item = responses(clock, len(calls)) if callable(responses) else (responses.pop(0) if responses else {'stories': [], 'outlook': outlook()})
            if isinstance(item, Exception):
                raise item
            return item
        def default_handle(story, stop_at=None):
            handled.append(story['id'])
            return 'set'
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / 'out.txt'
            with patch.dict(os.environ, {**ENV, 'GITHUB_OUTPUT': str(out)}), patch.object(mv, 'site_api', side_effect=api), patch.object(mp, 'handle', side_effect=handle or default_handle):
                claimed, results, chain = mp.run(clock=clock, sleep=clock.sleep)
            written = out.read_text()
        return claimed, results, chain, calls, handled, clock, written

    def test_quiet_writer_and_nothing_due_stops_without_chaining(self):
        claimed, results, chain, calls, handled, clock, written = self.run_with([{'stories': [], 'outlook': outlook(0, 3_600_000)}])
        self.assertEqual((claimed, chain, len(calls), clock.slept), (0, False, 1, []))
        self.assertIn('chain=false', written)

    def test_old_site_without_outlook_runs_one_pass(self):
        claimed, results, chain, calls, handled, clock, written = self.run_with([{'stories': [{'id': 'a', 'title': 'A'}]}, {'stories': []}])
        self.assertEqual((claimed, handled, chain), (1, ['a'], False))

    def test_waits_for_stories_the_writer_saves_later_and_hands_off_at_the_claim_limit(self):
        def responses(clock, n):
            # The writer is active the whole time; a new story appears every third poll.
            stories = [{'id': f's{n}', 'title': 'T'}] if n % 3 == 0 else []
            return {'stories': stories, 'outlook': outlook(written=2)}
        claimed, results, chain, calls, handled, clock, written = self.run_with(responses)
        self.assertTrue(chain)
        self.assertIn('chain=true', written)
        self.assertGreater(len(handled), 3)
        self.assertGreaterEqual(clock.t - 1_000_000.0, 9 * 60, 'kept claiming for the whole window')
        self.assertTrue(all(s <= 45 for s in clock.slept), 'polls at least every 45 seconds')
        self.assertTrue(all(p['limit'] <= 3 for path, p in calls), 'never claims more than its free workers')

    def test_retry_due_soon_keeps_the_run_waiting_but_a_distant_one_does_not(self):
        soon = [{'stories': [], 'outlook': outlook(0, 120_000)}, {'stories': [{'id': 'r', 'title': 'R'}], 'outlook': outlook(0, None)}, {'stories': [], 'outlook': outlook(0, None)}]
        claimed, results, chain, calls, handled, clock, written = self.run_with(soon)
        self.assertEqual((handled, chain), (['r'], False))
        self.assertEqual(clock.slept, [45])

    def test_claims_only_free_workers_and_tops_up_as_stories_finish(self):
        batches = [{'stories': [{'id': f'b{i}', 'title': 'B'} for i in range(3)], 'outlook': outlook(1)},
                   {'stories': [{'id': 'b3', 'title': 'B'}], 'outlook': outlook(0)}, {'stories': [], 'outlook': outlook(0)}]
        claimed, results, chain, calls, handled, clock, written = self.run_with(batches)
        self.assertEqual(calls[0][1], {'limit': 3})
        self.assertTrue(all(p['limit'] >= 1 for _, p in calls))
        self.assertEqual(sorted(handled), ['b0', 'b1', 'b2', 'b3'])
        self.assertEqual(results['set'], 4)

    def test_brief_queue_outage_is_retried_and_a_lasting_one_ends_without_chaining(self):
        flaky = [RuntimeError('503'), {'stories': [{'id': 'x', 'title': 'X'}], 'outlook': outlook(0)}, {'stories': [], 'outlook': outlook(0)}]
        claimed, results, chain, calls, handled, clock, written = self.run_with(flaky)
        self.assertEqual((handled, chain), (['x'], False))
        down = [RuntimeError('down')] * 6
        claimed, results, chain, calls, handled, clock, written = self.run_with(down)
        self.assertEqual((claimed, chain, len(calls)), (0, False, 5))
        self.assertLess(clock.t - 1_000_000.0, 5 * 60, 'gives up within minutes')

    def test_hand_off_is_written_before_the_last_slow_story_finishes(self):
        seen = {}
        clock_box = {}
        def responses(clock, n):
            clock_box['clock'] = clock
            return {'stories': [{'id': 'slow', 'title': 'S'}] if n == 1 else [], 'outlook': outlook(written=1)}
        def slow(story, stop_at=None):
            # The story outlives the claim window; the hand-off must already be on record meanwhile.
            clock_box['clock'].t += 10 * 60
            out = Path(os.environ['GITHUB_OUTPUT'])
            for _ in range(200):
                if out.exists() and 'chain=' in out.read_text():
                    break
                time.sleep(0.02)
            seen['before_finish'] = out.read_text() if out.exists() else ''
            return 'none'
        claimed, results, chain, calls, handled, clock, written = self.run_with(responses, handle=slow)
        self.assertIn('chain=true', seen['before_finish'])
        self.assertEqual(written.count('chain='), 1)
        self.assertTrue(chain)

    def test_story_started_after_the_stop_time_is_released_not_held(self):
        calls = []
        with patch.object(mv, 'site_api', side_effect=lambda path, payload, **kw: calls.append((path, payload)) or {'ok': True}), patch.object(mv, 'corroborated_media', side_effect=AssertionError('no work after the stop time')):
            self.assertEqual(mp.handle({'id': 'late-story-id', 'title': 'Late', 'photo_token': 't'}, stop_at=1), 'time')
        self.assertEqual(calls[0][0], '/api/photos/none')
        self.assertEqual(calls[0][1]['photo_token'], 't')

    def test_story_tries_only_copies_the_site_accepts(self):
        offered = []
        pool = [{'kind': 'photo', 'lead': True, 'outlets': 1, 'credit': 'Published by Daily', 'urls': []},
                {'kind': 'photo', 'lead': True, 'outlets': 1, 'credit': 'Published by Daily', 'urls': ['https://p.example/a.jpg', 'https://p.example/b.jpg', 'https://p.example/c.jpg', 'https://p.example/d.jpg']}]
        def api(path, payload, **kw):
            if path == '/api/photos/set':
                offered.append(payload['image'])
                return {'ok': False, 'why': 'image review unavailable, uncertain or rejected'}
            return {'ok': True}
        with patch.object(mv, 'site_api', side_effect=api), patch.object(mv, 'corroborated_media', return_value=pool):
            self.assertEqual(mp.handle({'id': 'story-id-12345', 'title': 'Story', 'photo_token': 't'}), 'none')
        self.assertEqual(offered, ['https://p.example/a.jpg', 'https://p.example/b.jpg', 'https://p.example/c.jpg'])


def picture(w, h, fmt='JPEG'):
    im = Image.new('RGB', (w, h), '#336688')
    d = ImageDraw.Draw(im)
    for i in range(12):
        d.rectangle((i * w // 12, (i * 37) % (h // 2), i * w // 12 + w // 20, h // 2 + (i * 29) % (h // 3)), fill=(i * 19, 200 - i * 11, 60 + i * 9))
    b = io.BytesIO(); im.save(b, fmt); return b.getvalue()


class NativeGate(unittest.TestCase):
    def test_gate_matches_the_site(self):
        self.assertTrue(mv.native_fits(1600, 1000))
        self.assertTrue(mv.native_fits(1200, 630))
        self.assertFalse(mv.native_fits(1920, 1080), 'over the 1.6 MP decode bound')
        self.assertFalse(mv.native_fits(1500, 1125), 'over the 1.6 MP decode bound')
        # Since 22 Oct 2026 the smallest photo is 800x400 (photo-policy.js PHOTO_MIN_WIDTH/HEIGHT).
        self.assertTrue(mv.native_fits(800, 450))
        self.assertTrue(mv.native_fits(1199, 800))
        self.assertFalse(mv.native_fits(799, 600))
        self.assertFalse(mv.native_fits(1600, 399))
        self.assertFalse(mv.native_fits(1600, 1000, size=4_500_001))
        self.assertFalse(mv.native_fits(1600, 1000, fmt='GIF'))
        self.assertFalse(mv.native_fits(1600, 1000, animated=True))
        # The site's own gate lives in the private repository; the exported public copy has no site code to compare.
        if (ROOT / 'photo-policy.js').exists() or (ROOT / 'media.js').exists():
            policy = (ROOT / 'photo-policy.js').read_text()
            self.assertIn(f"PHOTO_MAX_PIXELS = {mv.PHOTO_MAX_PIXELS:_}", policy)
            self.assertIn(f"max = {mv.PHOTO_MAX_BYTES:_}", (ROOT / 'media.js').read_text())

    def test_oversized_copy_counts_as_shared_but_only_the_fitting_copy_is_offered(self):
        big, fit = picture(1920, 1080), picture(1600, 900)
        bodies = {'https://a.example/big.jpg': big, 'https://b.example/fit.jpg': fit}
        sources = [{'url': 'https://a.example/report', 'outlet': 'Alpha', 'images': [{'url': 'https://a.example/big.jpg', 'source_url': 'https://a.example/report'}]},
                   {'url': 'https://b.example/report', 'outlet': 'Beta', 'images': [{'url': 'https://b.example/fit.jpg', 'source_url': 'https://b.example/report'}]}]
        with tempfile.TemporaryDirectory() as tmp, patch.object(mv, 'OUT', Path(tmp)), patch.object(mv, 'get', side_effect=lambda url, **k: bodies[url]), \
                patch.object(mv, 'site_api', return_value={'sources': sources}), patch.object(mv, 'page_media', return_value=([], [])):
            pool = mv.corroborated_media({'id': 'story', 'title': 'Story'}, videos=False)
        self.assertEqual(len(pool), 1)
        self.assertEqual(pool[0]['outlets'], 2)
        self.assertEqual(pool[0]['urls'], ['https://b.example/fit.jpg'])

    def test_only_oversized_copies_leave_nothing_to_offer(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(mv, 'OUT', Path(tmp)), patch.object(mv, 'get', return_value=picture(2000, 1125)):
            item = mv.load_image('https://a.example/big.jpg', 'https://a.example/report', 1)
        self.assertIsNotNone(item)
        self.assertFalse(item['fits'])


class CrawlerIdentity(unittest.TestCase):
    def test_publisher_pages_are_read_as_the_identified_crawler(self):
        seen = {}
        class Response:
            headers = {'content-type': 'text/html'}
            def read(self, n): return b'<html></html>'
            def geturl(self): return 'https://publisher.example/report'
            def __enter__(self): return self
            def __exit__(self, *a): return False
        class Opener:
            def open(self, request, timeout=None):
                seen['ua'] = request.get_header('User-agent')
                return Response()
        with patch.object(mv.urllib.request, 'build_opener', return_value=Opener()):
            mv.publisher_html('https://publisher.example/report')
        self.assertIn('GlobalNewsFlixBot', seen['ua'])
        self.assertNotIn('Chrome', seen['ua'])


if __name__ == '__main__':
    unittest.main()
