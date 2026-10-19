"""Current-article extraction needs only the standard library."""
import json
from pathlib import Path
import sys
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from article_media import article_image_urls, approved_photo_url, same_publisher_host

PAGE = 'https://publisher.example/report'
PHOTO = 'https://cdn.example/current.jpg'


def ld(nodes):
    return '<script type="application/ld+json">' + json.dumps(nodes) + '</script>'


class CurrentArticleImages(unittest.TestCase):
    def test_recommendations_and_organization_logos_never_become_lead_photos(self):
        html = ld({'@graph': [
            {'@type': 'Organization', 'logo': {'url': 'https://cdn.example/logo.jpg'}},
            {'@type': 'NewsArticle', 'url': PAGE, 'image': PHOTO},
            {'@type': 'NewsArticle', 'url': PAGE+'/unrelated', 'image': 'https://cdn.example/unrelated.jpg'},
        ]}) + '<article>Story</article><aside><img src="https://cdn.example/related.jpg"></aside>'
        self.assertEqual(article_image_urls(html, PAGE), [PHOTO])

    def test_unscoped_multiple_articles_and_website_share_cards_hold(self):
        self.assertEqual(article_image_urls(ld([{'@type':'Article','image':PHOTO}, {'@type':'Article','image':'https://cdn.example/other.jpg'}]), PAGE), [])
        self.assertEqual(article_image_urls('<meta property="og:type" content="website"><meta property="og:image" content="'+PHOTO+'">', PAGE), [])

    def test_current_main_entity_and_image_object_reference_are_resolved(self):
        html = ld({'@graph': [
            {'@type':'Article','mainEntityOfPage': {'@id':PAGE},'image':{'@id':'#photo'}},
            {'@type':'ImageObject','@id':'#photo','contentUrl':PHOTO},
        ]})
        self.assertEqual(article_image_urls(html, PAGE), [PHOTO])

    def test_social_article_image_accepts_reversed_attribute_order(self):
        html = '<meta content="article" property="og:type"><meta content="'+PHOTO+'" property="og:image">'
        self.assertEqual(article_image_urls(html, PAGE), [PHOTO])

    def test_third_party_canonical_cannot_authorize_an_unrelated_article(self):
        html = '<link rel="canonical" href="https://other.example/article">' + ld({'@type':'Article','url':'https://other.example/article','image':PHOTO})
        self.assertEqual(article_image_urls(html, PAGE), [])


class VideoAndPublisherBoundaries(unittest.TestCase):
    def test_video_only_accepts_pinned_site_photos(self):
        site='https://globalnewsflix.com'
        photo='/media/photos/'+'a'*64+'.jpg'
        self.assertEqual(approved_photo_url(photo,site),site+photo)
        self.assertEqual(approved_photo_url(site+photo,site),site+photo)
        for bad in ['https://publisher.example/photo.jpg',site+'.evil.test'+photo,'/media/photos/not-a-hash.jpg','/media/photos/'+'a'*64+'/w400.webp']:
            self.assertIsNone(approved_photo_url(bad,site))

    def test_publisher_redirect_boundaries(self):
        self.assertTrue(same_publisher_host('https://publisher.example/a','https://www.publisher.example/b'))
        for url in ['http://publisher.example/a','https://publisher.example.evil.test/a','https://other.example/a','https://user@publisher.example/a']:
            self.assertFalse(same_publisher_host('https://publisher.example/a',url))


if __name__ == '__main__':
    unittest.main()
