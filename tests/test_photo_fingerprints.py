"""Collector evidence derives from original bytes, including differently encoded copies."""
import hashlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
_previous_cwd = os.getcwd()
os.chdir(tempfile.mkdtemp())
import make_video as mv
import make_photos as mp
from PIL import Image, ImageDraw, ImageEnhance
os.chdir(_previous_cwd)


class PhotoMaintenanceHealth(unittest.TestCase):
    def test_health_failure_is_reported_after_queued_work(self):
        events, queue = [], [{'stories': [{'id': 'queued-story'}]}]
        def api(path, payload, **kw):
            events.append(path)
            if path.endswith('/queue'):
                return queue.pop(0) if queue else {'stories': []}
            raise RuntimeError('maintenance unavailable')
        def handle(story, stop_at=None):
            events.append(story['id'])
            return 'set'
        with patch.object(mv, 'site_api', side_effect=api), patch.object(mp, 'handle', side_effect=handle):
            with self.assertRaisesRegex(RuntimeError, 'maintenance unavailable'):
                mp.main()
        # The run asks once more after its story (nothing left, nothing expected), then checks health.
        self.assertEqual(events, ['/api/photos/queue', 'queued-story', '/api/photos/queue', '/api/photos/health'])

    def test_empty_queue_still_checks_health(self):
        with patch.object(mv, 'site_api', side_effect=[{'stories': []}, {'ok': False}]) as api:
            with self.assertRaisesRegex(RuntimeError, 'maintenance health'):
                mp.main()
        self.assertEqual(api.call_args.args[0], '/api/photos/health')


def scene():
    im = Image.new('RGB', (1600, 1000), '#336688')
    draw = ImageDraw.Draw(im)
    for i in range(16):
        draw.rectangle((i * 100, (i * 73) % 400, i * 100 + 65, 600 + (i * 17) % 300), fill=(i * 13, 220-i*9, 70+i*6))
    draw.ellipse((500, 200, 1250, 850), fill='#dbb439')
    return im


class PhotoFingerprints(unittest.TestCase):
    def test_collector_sha_binds_original_download_not_its_recompressed_working_file(self):
        image = scene()
        stream = io.BytesIO()
        image.save(stream, 'PNG')
        original = stream.getvalue()
        with tempfile.TemporaryDirectory() as tmp, patch.object(mv, 'OUT', Path(tmp)), patch.object(mv, 'get', return_value=original) as download:
            item = mv.load_image('https://publisher.example/photo.png', 'https://publisher.example/article', 1)
            self.assertIsNotNone(item)
            download.assert_called_once_with('https://publisher.example/photo.png', headers=mv.photo_request_headers('https://publisher.example/photo.png'))
            audit = item['perceptual']
            self.assertEqual(audit['algorithm'], 'dhash-v1')
            self.assertEqual(audit['sha256'], hashlib.sha256(original).hexdigest())
            self.assertNotEqual(audit['sha256'], hashlib.sha256(Path(item['path']).read_bytes()).hexdigest())
            self.assertEqual(audit['hashes'], [f'{x:016x}' for x in mv.fingerprints(image)])

    def test_resized_recompressed_and_central_crop_copies_remain_near(self):
        image = scene()
        copies = [image.resize((1200, 750)), image.crop((300, 0, 1300, 1000)), ImageEnhance.Color(image).enhance(0.9), ImageEnhance.Brightness(image).enhance(1.06)]
        stream = io.BytesIO()
        image.save(stream, 'JPEG', quality=55)
        copies.append(Image.open(io.BytesIO(stream.getvalue())))
        original = mv.fingerprints(image)
        for copy in copies:
            distance = min((a ^ b).bit_count() for a in original for b in mv.fingerprints(copy))
            self.assertLessEqual(distance, 8)

    def test_different_composition_of_the_same_subject_does_not_match(self):
        original = scene()
        another = Image.new('RGB', original.size, '#ddeeff')
        draw = ImageDraw.Draw(another)
        for i in range(20):
            x = (i * 137 + 80) % 1500
            y = (i * 223 + 110) % 900
            draw.ellipse((x, y, x+90, y+90), fill=(200-i*7, 20+i*9, 180-i*5))
        # Both images use colored structures against a blue background; different
        # compositions must not be equated merely because their subjects match.
        distance = min((a ^ b).bit_count() for a in mv.fingerprints(original) for b in mv.fingerprints(another))
        self.assertGreater(distance, 8)

    def test_photo_collector_uses_registered_story_sources_not_search_results(self):
        article = {'id': 'example', 'title': 'A current report'}
        sources = [{'url': 'https://publisher.example/report', 'outlet': 'Publisher'}]
        with patch.object(mv, 'site_api', return_value={'sources': sources}), patch.object(mv, 'page_media', return_value=([], [])) as pages, patch.object(mv, 'google_news_sources', side_effect=AssertionError('unregistered source search')):
            self.assertEqual(mv.corroborated_media(article, videos=False), [])
            pages.assert_called_once_with(sources[0]['url'])

    def test_photo_job_reads_draft_sources_from_the_photo_route(self):
        article = {'id': 'draft', 'title': 'A current report'}
        calls = []
        def api(path, payload):
            calls.append(path)
            return {'sources': []}
        with patch.object(mv, 'site_api', side_effect=api):
            mv.corroborated_media(article, videos=False)
        self.assertEqual(calls, ['/api/photos/sources'])

    def test_stored_lead_image_is_a_candidate_when_the_page_refuses_the_runner(self):
        article = {'id': 'draft', 'title': 'A current report'}
        lead = 'https://cdn.publisher.example/lead.jpg'
        sources = [{'url': 'https://publisher.example/report', 'outlet': 'Publisher', 'images': [{'url': lead, 'source_url': 'https://publisher.example/report'}]}]
        loaded = []
        def load(url, referer, n, tag=''):
            loaded.append(url)
            im = scene()
            return {'path': 'x.jpg', 'url': url, 'w': im.width, 'h': im.height, 'fp': mv.fingerprints(im), 'feat': None, 'perceptual': {'sha256': 'a' * 64}}
        with patch.object(mv, 'site_api', return_value={'sources': sources}), patch.object(mv, 'page_media', return_value=([], [])), patch.object(mv, 'load_image', side_effect=load):
            pool = mv.corroborated_media(article, videos=False)
        self.assertEqual(loaded, [lead])
        self.assertEqual(len(pool), 1)
        self.assertTrue(pool[0]['lead'])
        self.assertEqual(pool[0]['urls'], [lead])
        self.assertEqual(pool[0]['credit'], 'Published by Publisher')

    def test_stored_images_are_merged_without_duplicates_or_branding_assets(self):
        source = {'images': [{'url': 'https://p.example/a.jpg'}, {'url': 'https://p.example/logo.jpg'}, {'url': 'http://p.example/b.jpg'}]}
        self.assertEqual(mv.stored_lead_images(source, [('https://p.example/a.jpg', True), ('https://p.example/c.jpg', True)]),
                         [('https://p.example/a.jpg', True), ('https://p.example/c.jpg', True)])

    def test_video_uses_only_current_server_approved_bytes(self):
        article={'id':'example','title':'Current report'}
        sha='a'*64
        approved={'url':'https://globalnewsflix.com/media/photos/'+sha+'.jpg','image_hash':sha,'credit':'Verified source'}
        item={'path':'approved.jpg','perceptual':{'sha256':sha}}
        with patch.object(mv,'site_api',return_value={'sources':[{'url':'https://publisher.example/article'}],'approved_image':approved}), patch.object(mv,'load_image',return_value=item), patch.object(mv,'page_media',side_effect=AssertionError('raw source bypass')), patch.object(mv,'google_news_sources',side_effect=AssertionError('search bypass')):
            self.assertEqual(mv.corroborated_media(article,videos=True)[0]['path'],'approved.jpg')
        with patch.object(mv,'site_api',return_value={'approved_image':approved}), patch.object(mv,'load_image',return_value={'path':'wrong.jpg','perceptual':{'sha256':'b'*64}}):
            self.assertEqual(mv.corroborated_media(article,videos=True),[])
        with patch.object(mv,'site_api',return_value={'sources':[{'url':'https://publisher.example/article'}]}), patch.object(mv,'page_media',side_effect=AssertionError('raw bypass')):
            self.assertEqual(mv.corroborated_media(article,videos=True),[])

    def test_native_small_image_is_not_promoted_by_the_collector(self):
        stream = io.BytesIO()
        scene().resize((800, 500)).save(stream, 'PNG')
        with patch.object(mv, 'get', return_value=stream.getvalue()):
            self.assertIsNone(mv.load_image('https://publisher.example/photo.png?w=1600', 'https://publisher.example/article', 1))


if __name__ == '__main__':
    unittest.main()
